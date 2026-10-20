// Reading and organising mail.
import type { KeyObject } from 'node:crypto'
import type { Folder, Message, OutgoingMessage, Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { accessibleAccounts, loadBody, requireMessage } from '../../lib/access.ts'
import { decrypt as decryptSecret } from '../../lib/crypto.ts'
import { notFound, parse } from '../../lib/http.ts'
import { requireUser, storageKey } from '../../lib/session.ts'
import { messageParts, openBody, openSummary } from './private.ts'
import { toIcs } from '../../plugins/nextcloud.ts'
import * as smime from '../send/smime.ts'
import { deleteMessage, moveMessage, setFlags } from './actions.ts'
import { parseRaw } from './parse.ts'

const FOLDERS = ['inbox', 'starred', 'scheduled', 'drafts', 'sent', 'archive', 'spam', 'trash'] as const

// The shape the web app works with (see apps/web/src/types.ts).
function toRow(message: Omit<Message, 'raw' | 'html' | 'text' | 'sealedBody'> & { folder: Folder }, key: KeyObject | null) {
  const summary = openSummary(message, key)
  return {
    id: message.id,
    accountId: message.accountId,
    folder: message.folder.role,
    category: message.category,
    from: { name: message.fromName, email: message.fromEmail },
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    preview: summary.preview,
    date: message.date,
    unread: message.unread,
    starred: message.starred,
    labels: message.labels,
    attachments: summary.attachments,
    security: message.security,
    event: summary.event,
  }
}

// Drafts and scheduled mail live in OutgoingMessage until sent; show them like messages.
function outgoingToRow(outgoing: OutgoingMessage, me: { name: string; email: string }) {
  const p = outgoing.payload as { accountId: string; to: string[]; cc: string[]; subject: string; text: string; html?: string; forwardOf?: string; attachments: { filename: string; contentType: string; content: string }[] }
  return {
    id: outgoing.id,
    accountId: outgoing.accountId,
    folder: outgoing.status === 'draft' ? 'drafts' : 'scheduled',
    category: 'people',
    from: me,
    to: p.to.map((email) => ({ name: email, email })),
    cc: p.cc.map((email) => ({ name: email, email })),
    subject: p.subject || '(no subject)',
    preview: p.text.slice(0, 180),
    html: p.html,
    text: p.text,
    date: outgoing.updatedAt,
    unread: false,
    starred: false,
    labels: [],
    attachments: p.attachments.map((a, i) => ({ id: String(i), filename: a.filename, contentType: a.contentType, size: Math.floor((a.content.length * 3) / 4) })),
    scheduledFor: outgoing.scheduledFor,
    forwardOf: p.forwardOf,
    error: outgoing.error,
    outgoing: true,
  }
}

export async function mailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  // Unread counts for the sidebar.
  app.get('/counts', async (request) => {
    const accountIds = (await accessibleAccounts(request.user.id)).map((a) => a.account.id)
    const unread = await db.message.groupBy({ by: ['folderId', 'accountId'], where: { accountId: { in: accountIds }, unread: true }, _count: true })
    const folders = await db.folder.findMany({ where: { accountId: { in: accountIds } } })
    const roleOf = new Map(folders.map((f) => [f.id, f.role]))

    const byFolder: Record<string, number> = {}
    const byAccount: Record<string, number> = {}
    for (const row of unread) {
      const role = roleOf.get(row.folderId)!
      byFolder[role] = (byFolder[role] ?? 0) + row._count
      if (role === 'inbox') byAccount[row.accountId] = (byAccount[row.accountId] ?? 0) + row._count
    }
    byFolder.starred = await db.message.count({ where: { accountId: { in: accountIds }, starred: true, unread: true } })
    byFolder.scheduled = await db.outgoingMessage.count({ where: { userId: request.user.id, status: { in: ['scheduled', 'failed'] } } })
    byFolder.drafts = await db.outgoingMessage.count({ where: { userId: request.user.id, status: 'draft' } })

    const labelRows = await db.$queryRaw<{ label: string; count: bigint }[]>`
      SELECT unnest(labels) AS label, count(*) AS count FROM "Message"
      WHERE "accountId" = ANY(${accountIds}) AND unread GROUP BY 1`
    const byLabel = Object.fromEntries(labelRows.map((r) => [r.label, Number(r.count)]))
    return { folders: byFolder, accounts: byAccount, labels: byLabel }
  })

  app.get('/messages', async (request) => {
    const query = parse(
      z.object({
        folder: z.enum(FOLDERS).default('inbox'),
        account: z.string().optional(),
        label: z.string().optional(),
        q: z.string().trim().optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(200), // the web app raises this for "Load older mail"
      }),
      request.query,
    )
    const me = { name: request.user.name, email: request.user.email }
    let accountIds = (await accessibleAccounts(request.user.id)).map((a) => a.account.id)
    if (query.account) accountIds = accountIds.filter((id) => id === query.account)

    const outgoing = (status: Prisma.OutgoingMessageWhereInput['status']) =>
      db.outgoingMessage
        .findMany({ where: { userId: request.user.id, accountId: { in: accountIds }, status }, orderBy: { updatedAt: 'desc' } })
        .then((rows) => rows.map((o) => outgoingToRow(o, me)))
    if (query.folder === 'scheduled') return outgoing({ in: ['scheduled', 'failed'] })

    const where: Prisma.MessageWhereInput = {
      accountId: { in: accountIds },
      ...(query.folder === 'starred' ? { starred: true, folder: { role: { notIn: ['trash', 'spam'] } } } : { folder: { role: query.folder } }),
      ...(query.label && { labels: { has: query.label } }),
    }
    if (query.q) {
      // Full-text search over subject, sender and body (Postgres tsvector, see the init migration).
      const hits = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Message" WHERE "accountId" = ANY(${accountIds}) AND search @@ websearch_to_tsquery('simple', ${query.q})
        ORDER BY ts_rank(search, websearch_to_tsquery('simple', ${query.q})) DESC, date DESC LIMIT 200`
      // Search looks across every folder, not just the one that is open.
      delete where.folder
      delete where.starred
      where.id = { in: hits.map((h) => h.id) }
    }
    const messages = await db.message.findMany({
      where,
      include: { folder: true },
      omit: { raw: true, html: true, text: true, sealedBody: true },
      orderBy: { date: 'desc' },
      take: query.limit,
    })
    const key = await storageKey(request)
    const rows = messages.map((m) => toRow(m, key))
    // Drafts written in Nexus, plus drafts other mail apps saved to the server's Drafts folder.
    return query.folder === 'drafts' && !query.q ? [...(await outgoing('draft')), ...rows] : rows
  })

  app.get<{ Params: { id: string } }>('/messages/:id', async (request) => {
    const outgoing = await db.outgoingMessage.findFirst({ where: { id: request.params.id, userId: request.user.id } })
    if (outgoing) return outgoingToRow(outgoing, { name: request.user.name, email: request.user.email })

    const message = await requireMessage(request.user.id, request.params.id, 'viewer')
    const key = await storageKey(request)
    const body = openBody(await loadBody(message.id), key)
    const detail = { ...toRow(message, key), messageId: message.messageId, html: body.html, text: body.text, signature: undefined as string | undefined }

    if (message.security === 'smime-encrypted') {
      const cert = await db.smimeCert.findFirst({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' } })
      if (cert) {
        const inner = await parseRaw(await smime.decrypt(body.raw, cert.certPem, decryptSecret(cert.keyPem))).catch(() => null)
        if (inner) Object.assign(detail, { html: inner.html, text: inner.text, attachments: inner.attachments })
      }
    }
    if (message.security === 'smime-signed') {
      const result = await smime.verify(body.raw)
      detail.signature = result.status
      // Keep the sender's certificate so you can send them encrypted mail later. Self-signed certificates
      // are common on home servers, so intact-but-untrusted ones are kept too; the UI says which it is.
      if (result.signerPem) await rememberCertificate(request.user.id, message.fromEmail, message.fromName, result.signerPem)
    }
    return detail
  })

  app.patch<{ Params: { id: string } }>('/messages/:id', async (request) => {
    const flags = parse(z.object({ unread: z.boolean().optional(), starred: z.boolean().optional() }), request.body)
    const message = await requireMessage(request.user.id, request.params.id, 'editor')
    if (Object.keys(flags).length) await setFlags(message, flags)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/messages/:id/move', async (request) => {
    const { to } = parse(z.object({ to: z.enum(['inbox', 'archive', 'spam', 'trash', 'sent']) }), request.body)
    const message = await requireMessage(request.user.id, request.params.id, 'editor')
    await moveMessage(message, to)
    return { ok: true }
  })

  // "Mark as spam" also blocks the sender; "Not spam" unblocks them and returns the mail to the inbox.
  app.post<{ Params: { id: string } }>('/messages/:id/spam', async (request) => {
    const { spam } = parse(z.object({ spam: z.boolean() }), request.body)
    const message = await requireMessage(request.user.id, request.params.id, 'editor')
    const key = { userId: request.user.id, pattern: message.fromEmail }
    if (spam && message.fromEmail) await db.blockedSender.upsert({ where: { userId_pattern: key }, create: key, update: {} })
    else await db.blockedSender.deleteMany({ where: key })
    await moveMessage(message, spam ? 'spam' : 'inbox')
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/messages/:id', async (request) => {
    const message = await requireMessage(request.user.id, request.params.id, 'editor')
    await deleteMessage(message)
    return { ok: true }
  })

  // Attachments are cut out of the stored raw message on demand.
  app.get<{ Params: { id: string; attachmentId: string }; Querystring: { download?: string } }>('/messages/:id/attachments/:attachmentId', async (request, reply) => {
    const message = await requireMessage(request.user.id, request.params.id, 'viewer')
    const file = (await messageParts(message.id, await storageKey(request)))[Number(request.params.attachmentId)]
    if (!file) throw notFound('Attachment')

    // Only types browsers render safely are shown inline; everything else downloads.
    const previewable = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(file.contentType)
    const inline = previewable && request.query.download === undefined
    const name = (file.filename ?? 'attachment').replace(/["\r\n]/g, '')
    reply
      .header('content-type', file.contentType === 'text/plain' ? 'text/plain; charset=utf-8' : file.contentType)
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('x-content-type-options', 'nosniff')
    // PDFs need the browser's viewer, which a sandbox blocks; everything else is sandboxed.
    if (file.contentType !== 'application/pdf') reply.header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
    return reply.send(file.content)
  })

  app.get<{ Params: { id: string } }>('/messages/:id/raw', async (request, reply) => {
    const message = await requireMessage(request.user.id, request.params.id, 'viewer')
    return reply.header('content-type', 'message/rfc822').header('content-disposition', `attachment; filename="message-${message.id}.eml"`).send(openBody(await loadBody(message.id), await storageKey(request)).raw)
  })

  app.get<{ Params: { id: string } }>('/messages/:id/event.ics', async (request, reply) => {
    const message = await requireMessage(request.user.id, request.params.id, 'viewer')
    const { event } = openSummary(message, await storageKey(request))
    if (!event) throw notFound('Event')
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="event.ics"').send(toIcs(event, `${message.id}@nexus`))
  })
}

async function rememberCertificate(userId: string, email: string, name: string, pem: string) {
  const contact = await db.contact.findFirst({ where: { userId, emails: { has: email } } })
  if (contact) {
    if (contact.smimeCert !== pem) await db.contact.update({ where: { id: contact.id }, data: { smimeCert: pem } })
  } else {
    await db.contact.create({ data: { userId, name, emails: [email], smimeCert: pem } })
  }
}
