// Mail accounts: adding, editing, sharing, syncing, and OAuth sign-in.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { queueSync } from '../../jobs/queue.ts'
import { accessibleAccounts, requireAccountRole } from '../../lib/access.ts'
import { encrypt, randomToken } from '../../lib/crypto.ts'
import { HttpError, badRequest, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { testConnection } from './connect.ts'
import { authorizeUrl, exchangeCode, getProvider } from './oauth.ts'

const COLORS = ['#ff7f6e', '#4fd1a1', '#6ea8ff', '#f5b544', '#c79bff', '#5fc6e8']

const serverFields = {
  inHost: z.string().trim().min(1),
  inPort: z.number().int().min(1).max(65535),
  inTls: z.boolean(),
  smtpHost: z.string().trim().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpTls: z.boolean(),
  username: z.string().trim().min(1),
}

export async function accountRoutes(app: FastifyInstance) {
  // The OAuth callback is a redirect from Google/Microsoft. Browsers don't send our strict
  // session cookie on that cross-site hop, so the pending sign-in is remembered here by `state`.
  const pendingOAuth = new Map<string, { userId: string; expires: number }>()

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>('/oauth/:provider/callback', async (request, reply) => {
    const { code, state, error } = request.query
    const pending = state ? pendingOAuth.get(state) : undefined
    if (state) pendingOAuth.delete(state)
    if (error) return reply.redirect(`/settings/accounts?error=${encodeURIComponent(error)}`)
    if (!code || !pending || pending.expires < Date.now()) throw new HttpError(400, 'This sign-in link expired. Start again from Settings.')

    const provider = getProvider(request.params.provider)
    const tokens = await exchangeCode(request.params.provider, code)
    const count = await db.account.count({ where: { ownerId: pending.userId } })
    const account = await db.account.create({
      data: {
        ownerId: pending.userId,
        email: tokens.email,
        name: tokens.name,
        color: COLORS[count % COLORS.length],
        protocol: 'imap',
        auth: provider.auth,
        username: tokens.email,
        secret: encrypt(tokens.refreshToken),
        ...provider.servers,
      },
    })
    await queueSync(account.id)
    return reply.redirect('/settings/accounts?added=1')
  })

  app.register(async (signedIn) => {
    signedIn.addHook('preHandler', requireUser)

    signedIn.get('/oauth/:provider/start', async (request) => {
      const { provider } = request.params as { provider: string }
      const state = randomToken()
      pendingOAuth.set(state, { userId: request.user.id, expires: Date.now() + 10 * 60_000 })
      return { url: authorizeUrl(provider, state) }
    })

    signedIn.get('/accounts', async (request) => {
      const list = await accessibleAccounts(request.user.id)
      return list.map(({ account, role }) => ({
        id: account.id,
        email: account.email,
        name: account.name,
        color: account.color,
        protocol: account.protocol,
        auth: account.auth,
        role,
        signature: account.signature,
        lastSyncAt: account.lastSyncAt,
        syncError: account.syncError,
        // Server details only for the owner; members don't need them.
        ...(role === 'owner' && { inHost: account.inHost, inPort: account.inPort, inTls: account.inTls, smtpHost: account.smtpHost, smtpPort: account.smtpPort, smtpTls: account.smtpTls, username: account.username }),
      }))
    })

    signedIn.post('/accounts', async (request) => {
      const body = parse(
        z.object({
          email: z.string().trim().toLowerCase().email(),
          name: z.string().trim().min(1),
          protocol: z.enum(['imap', 'pop3']),
          password: z.string().min(1),
          ...serverFields,
        }),
        request.body,
      )
      if (body.protocol === 'pop3' && (await usesPrivateStorage(request.user.id))) {
        throw badRequest('POP3 accounts can’t be added while private storage is on, because Nexus would hold the only copy of their mail.')
      }
      const settings = { ...body, id: 'new', auth: 'password', secret: encrypt(body.password) }
      await testConnection(settings).catch((error: Error) => {
        throw badRequest(`Could not connect: ${error.message}`)
      })
      const count = await db.account.count({ where: { ownerId: request.user.id } })
      const { password: _password, ...fields } = body
      const account = await db.account.create({
        data: { ...fields, ownerId: request.user.id, auth: 'password', secret: settings.secret, color: COLORS[count % COLORS.length] },
      })
      await queueSync(account.id)
      return { id: account.id }
    })

    signedIn.patch<{ Params: { id: string } }>('/accounts/:id', async (request) => {
      const role = await requireAccountRole(request.user.id, request.params.id, 'editor')
      const body = parse(
        z.object({
          name: z.string().trim().min(1).optional(),
          color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
          signature: z.string().max(20_000).optional(),
          password: z.string().min(1).optional(),
          ...Object.fromEntries(Object.entries(serverFields).map(([k, v]) => [k, v.optional()])),
        }),
        request.body,
      )
      // Editors may change the signature; everything else is the owner's call.
      const { signature, password, ...rest } = body
      if (role !== 'owner' && (password || Object.keys(rest).length)) throw new HttpError(403, 'Only the owner can change account settings')
      const data = { ...rest, ...(signature !== undefined && { signature }), ...(password && { secret: encrypt(password) }) }

      if (password || Object.keys(serverFields).some((k) => k in rest)) {
        const current = await db.account.findUniqueOrThrow({ where: { id: request.params.id } })
        await testConnection({ ...current, ...data }).catch((error: Error) => {
          throw badRequest(`Could not connect: ${error.message}`)
        })
      }
      await db.account.update({ where: { id: request.params.id }, data })
      return { ok: true }
    })

    signedIn.delete<{ Params: { id: string } }>('/accounts/:id', async (request) => {
      await requireAccountRole(request.user.id, request.params.id, 'owner')
      await db.account.delete({ where: { id: request.params.id } }) // mail stays on the server, only Nexus's copy goes
      return { ok: true }
    })

    signedIn.post<{ Params: { id: string } }>('/accounts/:id/sync', async (request) => {
      await requireAccountRole(request.user.id, request.params.id, 'viewer')
      await queueSync(request.params.id)
      return { ok: true }
    })

    // ---------- Sharing (ACL) ----------

    signedIn.get<{ Params: { id: string } }>('/accounts/:id/members', async (request) => {
      await requireAccountRole(request.user.id, request.params.id, 'owner')
      const members = await db.accountMember.findMany({ where: { accountId: request.params.id }, include: { user: { select: { name: true, email: true } } } })
      return members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role }))
    })

    signedIn.put<{ Params: { id: string } }>('/accounts/:id/members', async (request) => {
      await requireAccountRole(request.user.id, request.params.id, 'owner')
      const { userId, role } = parse(z.object({ userId: z.string(), role: z.enum(['editor', 'viewer']) }), request.body)
      if (userId === request.user.id) throw badRequest('You already own this account')
      if (await usesPrivateStorage(request.user.id)) throw badRequest('Accounts can’t be shared while private storage is on: other people couldn’t read the mail.')
      await db.accountMember.upsert({
        where: { accountId_userId: { accountId: request.params.id, userId } },
        create: { accountId: request.params.id, userId, role },
        update: { role },
      })
      return { ok: true }
    })

    signedIn.delete<{ Params: { id: string; userId: string } }>('/accounts/:id/members/:userId', async (request) => {
      await requireAccountRole(request.user.id, request.params.id, 'owner')
      await db.accountMember.deleteMany({ where: { accountId: request.params.id, userId: request.params.userId } })
      return { ok: true }
    })
  })
}

const usesPrivateStorage = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { privateStorage: true } })).privateStorage
