// Importing .eml/.mbox files and exporting folders as .mbox.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { accessibleAccounts, requireAccountRole } from '../../lib/access.ts'
import { badRequest, parse } from '../../lib/http.ts'
import { requireUser, storageKey } from '../../lib/session.ts'
import { openBody } from '../mail/private.ts'
import { withImap } from '../accounts/connect.ts'
import { parseRaw } from '../mail/parse.ts'
import { classify } from '../mail/sorting.ts'
import { saveMessage } from '../mail/store.ts'
import { discoverFolders, localFolders } from '../mail/sync.ts'
import { queueSync } from '../../jobs/queue.ts'
import { splitMbox, toMbox } from './mbox.ts'

export async function importExportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  // Upload: multipart form with fields accountId, folder, and one or more files.
  app.post('/import', async (request) => {
    let accountId = ''
    let folderRole = 'archive'
    const messages: Buffer[] = []
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'accountId') accountId = String(part.value)
        if (part.fieldname === 'folder') folderRole = String(part.value)
      } else {
        const file = await part.toBuffer()
        messages.push(...(/\.mbox$/i.test(part.filename) || file.subarray(0, 5).toString() === 'From ' ? splitMbox(file) : [file]))
      }
    }
    const { folder } = parse(z.object({ folder: z.enum(['inbox', 'archive', 'sent']) }), { folder: folderRole })
    await requireAccountRole(request.user.id, accountId, 'editor')
    if (!messages.length) throw badRequest('Choose at least one .eml or .mbox file')
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } })

    // IMAP: upload to the server so every mail app sees it; the next sync brings it into Nexus.
    if (account.protocol === 'imap') {
      await withImap(account, async (client) => {
        const target = (await discoverFolders(client, account.id)).get(folder)!
        for (const raw of messages) await client.append(target.path, raw, ['\\Seen'])
      })
      await queueSync(account.id)
    } else {
      const target = (await localFolders(account.id)).get(folder)!
      for (const raw of messages) {
        const parsed = await parseRaw(raw)
        const category = classify({ fromEmail: parsed.from.email, subject: parsed.subject, isMailingList: parsed.isMailingList, isAutomated: parsed.isAutomated, hasEvent: !!parsed.event })
        await saveMessage({ accountId: account.id, folderId: target.id, raw, parsed, unread: false, starred: false, category, labels: [] })
      }
    }
    return { imported: messages.length }
  })

  app.get('/export.mbox', async (request, reply) => {
    const query = parse(z.object({ account: z.string().optional(), folder: z.enum(['inbox', 'sent', 'archive', 'spam', 'trash']).optional() }), request.query)
    let accountIds = (await accessibleAccounts(request.user.id)).map((a) => a.account.id)
    if (query.account) accountIds = accountIds.filter((id) => id === query.account)
    const key = await storageKey(request)
    // shortcut: builds the whole file in memory; stream it if people export mailboxes larger than a few GB.
    const messages = await db.message.findMany({
      where: { accountId: { in: accountIds }, ...(query.folder && { folder: { role: query.folder } }) },
      select: { raw: true, html: true, text: true, sealedBody: true, fromEmail: true, date: true },
      orderBy: { date: 'asc' },
    })
    return reply
      .header('content-type', 'application/mbox')
      .header('content-disposition', `attachment; filename="nexus-${query.folder ?? 'all'}.mbox"`)
      .send(toMbox(messages.map((m) => ({ fromEmail: m.fromEmail, date: m.date, raw: openBody(m, key).raw }))))
  })
}
