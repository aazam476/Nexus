// Mail accounts: adding, editing, sharing, syncing, and OAuth sign-in.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { queueSync } from '../../jobs/queue.ts'
import { accessibleAccounts, requireAccountRole } from '../../lib/access.ts'
import { encrypt, randomToken } from '../../lib/crypto.ts'
import { HttpError, badRequest, errorMessage, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { testConnection } from './connect.ts'
import { authorizeUrl, exchangeCode, forgetAccessToken, getProvider } from './oauth.ts'

const COLORS = ['#ff7f6e', '#4fd1a1', '#6ea8ff', '#f5b544', '#c79bff', '#5fc6e8']

const HEX_COLOR = /^#[0-9a-f]{6}$/i // like "#4fd1a1"

// Where an account's mail servers are, and the login for them. Shared by "add" and "edit".
const serverFields = z.object({
  inHost: z.string().trim().min(1),
  inPort: z.number().int().min(1).max(65535),
  inTls: z.boolean(), // true = encrypted from the start; false = upgrade with STARTTLS
  smtpHost: z.string().trim().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpTls: z.boolean(),
  username: z.string().trim().min(1),
})

export async function accountRoutes(app: FastifyInstance) {
  // The OAuth callback is a redirect from Google/Microsoft. Browsers don't send our strict
  // session cookie on that cross-site hop, so the pending sign-in is remembered here by `state`.
  const pendingOAuth = new Map<string, { userId: string; expires: number }>()

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/oauth/:provider/callback',
    async (request, reply) => {
      const { code, state, error } = request.query
      const pending = state ? pendingOAuth.get(state) : undefined
      if (state) pendingOAuth.delete(state)
      if (error) return reply.redirect(`/settings/accounts?error=${encodeURIComponent(error)}`)
      if (!code || !pending || pending.expires < Date.now())
        throw new HttpError(400, 'This sign-in link expired. Start again from Settings.')

      const tokens = await exchangeCode(request.params.provider, code)
      const accountId = await saveOAuthAccount(pending.userId, request.params.provider, tokens)
      await queueSync(accountId)
      return reply.redirect('/settings/accounts?added=1')
    },
  )

  app.register(async (signedIn) => {
    signedIn.addHook('preHandler', requireUser)

    signedIn.get('/oauth/:provider/start', async (request) => {
      const { provider } = request.params as { provider: string }
      const state = randomToken()
      // Drop sign-ins nobody finished, so the map can't grow forever.
      for (const [old, pending] of pendingOAuth) if (pending.expires < Date.now()) pendingOAuth.delete(old)
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
        ...(role === 'owner' && {
          inHost: account.inHost,
          inPort: account.inPort,
          inTls: account.inTls,
          smtpHost: account.smtpHost,
          smtpPort: account.smtpPort,
          smtpTls: account.smtpTls,
          username: account.username,
        }),
      }))
    })

    signedIn.post('/accounts', async (request) => {
      const body = parse(
        serverFields.extend({
          email: z.string().trim().toLowerCase().email(),
          name: z.string().trim().min(1),
          protocol: z.enum(['imap', 'pop3']),
          password: z.string().min(1),
        }),
        request.body,
      )
      if (body.protocol === 'pop3' && (await usesPrivateStorage(request.user.id))) {
        throw badRequest(
          'POP3 accounts can’t be added while private storage is on, because Nexus would hold the only copy of their mail.',
        )
      }
      if (await db.account.findFirst({ where: { ownerId: request.user.id, email: body.email } })) {
        throw badRequest('You already added this account. To change its password, use Edit on the account.')
      }
      // Try the login before saving anything. testConnection takes an account-shaped object,
      // so give it one; the id isn't used for password logins.
      const { password, ...fields } = body
      const secret = encrypt(password)
      await testConnection({ ...fields, id: 'not-saved-yet', auth: 'password', secret }).catch((error) => {
        throw badRequest(`Could not connect: ${errorMessage(error)}`)
      })
      const account = await db.account.create({
        data: {
          ...fields,
          ownerId: request.user.id,
          auth: 'password',
          secret,
          color: await nextColor(request.user.id),
        },
      })
      await queueSync(account.id)
      return { id: account.id }
    })

    signedIn.patch<{ Params: { id: string } }>('/accounts/:id', async (request) => {
      const role = await requireAccountRole(request.user.id, request.params.id, 'editor')
      // Every field is optional: only what's sent changes.
      const body = parse(
        serverFields.partial().extend({
          name: z.string().trim().min(1).optional(),
          color: z.string().regex(HEX_COLOR).optional(),
          signature: z.string().max(20_000).optional(),
          password: z.string().min(1).optional(),
        }),
        request.body,
      )
      // Editors may change the signature; everything else is the owner's call.
      const { signature, password, ...rest } = body
      if (role !== 'owner' && (password || Object.keys(rest).length))
        throw new HttpError(403, 'Only the owner can change account settings')
      const data = {
        ...rest,
        ...(signature !== undefined && { signature }),
        ...(password && { secret: encrypt(password) }),
      }

      // A new password or server: check the login works before saving it.
      const changesLogin = password || Object.keys(serverFields.shape).some((field) => field in rest)
      if (changesLogin) {
        const current = await db.account.findUniqueOrThrow({ where: { id: request.params.id } })
        await testConnection({ ...current, ...data }).catch((error) => {
          throw badRequest(`Could not connect: ${errorMessage(error)}`)
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
      const members = await db.accountMember.findMany({
        where: { accountId: request.params.id },
        include: { user: { select: { name: true, email: true } } },
      })
      return members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role }))
    })

    signedIn.put<{ Params: { id: string } }>('/accounts/:id/members', async (request) => {
      await requireAccountRole(request.user.id, request.params.id, 'owner')
      const { userId, role } = parse(z.object({ userId: z.string(), role: z.enum(['editor', 'viewer']) }), request.body)
      if (userId === request.user.id) throw badRequest('You already own this account')
      if (await usesPrivateStorage(request.user.id))
        throw badRequest('Accounts can’t be shared while private storage is on: other people couldn’t read the mail.')
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

async function usesPrivateStorage(userId: string): Promise<boolean> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { privateStorage: true } })
  return user.privateStorage
}

// Each new account gets the next colour in the list, so accounts are easy to tell apart.
async function nextColor(userId: string): Promise<string> {
  const count = await db.account.count({ where: { ownerId: userId } })
  return COLORS[count % COLORS.length]
}

// After Google/Microsoft sign-in: adds the account, or updates it if it was added before.
// (Signing in again is how people fix an expired sign-in, so it must not create a second copy.)
async function saveOAuthAccount(
  userId: string,
  providerName: string,
  tokens: { email: string; name: string; refreshToken: string },
) {
  const provider = getProvider(providerName)
  const secret = encrypt(tokens.refreshToken)
  const existing = await db.account.findFirst({ where: { ownerId: userId, email: tokens.email, auth: provider.auth } })
  if (existing) {
    await db.account.update({ where: { id: existing.id }, data: { secret, syncError: null } })
    forgetAccessToken(existing.id) // don't keep using an access token from the old sign-in
    return existing.id
  }
  const account = await db.account.create({
    data: {
      ownerId: userId,
      email: tokens.email,
      name: tokens.name,
      color: await nextColor(userId),
      protocol: 'imap',
      auth: provider.auth,
      username: tokens.email,
      secret,
      ...provider.servers,
    },
  })
  return account.id
}
