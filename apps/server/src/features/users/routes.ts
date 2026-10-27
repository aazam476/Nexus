// Users on this server. Admins manage them; everyone can see the directory to share accounts.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { hashPassword } from '../../lib/crypto.ts'
import { badRequest, HttpError, parse } from '../../lib/http.ts'
import { queueSync } from '../../jobs/queue.ts'
import { requireAdmin, requireUser } from '../../lib/session.ts'

export async function userRoutes(app: FastifyInstance) {
  // Names and emails only, for the "share an account" picker.
  app.get('/directory', { preHandler: requireUser }, async () =>
    db.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  )

  app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin)

    admin.get('/', async () => {
      const users = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
      return users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        totpEnabled: u.totpEnabled,
        privateStorage: u.privateStorage,
        createdAt: u.createdAt,
      }))
    })

    // Counts for the admin dashboard, and the mail accounts that fail to sync. Never anyone's mail.
    admin.get('/overview', async () => {
      const [users, accounts, feeds, failing] = await Promise.all([
        db.user.count(),
        db.account.count(),
        db.feed.count(),
        db.account.findMany({
          where: { syncError: { not: null } },
          select: { id: true, email: true, syncError: true, owner: { select: { name: true } } },
          orderBy: { email: 'asc' },
        }),
      ])
      return { users, accounts, feeds, failing }
    })

    // Admin creates the account with a starting password and passes it on; the user can change it.
    admin.post('/', async (request) => {
      const body = parse(
        z.object({
          name: z.string().trim().min(1),
          email: z.string().trim().toLowerCase().email(),
          password: z.string().min(12, 'Use at least 12 characters'),
          role: z.enum(['admin', 'user']).default('user'),
        }),
        request.body,
      )
      if (await db.user.findUnique({ where: { email: body.email } }))
        throw badRequest('That email is already registered')
      const user = await db.user.create({
        data: { name: body.name, email: body.email, role: body.role, passwordHash: await hashPassword(body.password) },
      })
      return { id: user.id }
    })

    admin.patch<{ Params: { id: string } }>('/:id', async (request) => {
      const { role } = parse(z.object({ role: z.enum(['admin', 'user']) }), request.body)
      if (request.params.id === request.user.id && role !== 'admin')
        throw badRequest('You cannot remove your own admin role')
      await db.user.update({ where: { id: request.params.id }, data: { role } })
      return { ok: true }
    })

    // For someone who forgot their password: a new starting password, and every device signed out.
    admin.post<{ Params: { id: string } }>('/:id/password', async (request) => {
      const { password } = parse(z.object({ password: z.string().min(12, 'Use at least 12 characters') }), request.body)
      const user = await db.user.findUnique({ where: { id: request.params.id } })
      if (!user) throw new HttpError(404, 'User not found')
      // Private storage locks the stored mail with the old password, so nobody can open it again.
      // It's only a copy of what's on the mail server, though: delete it and download it afresh.
      // (POP3 mail is never locked: private storage refuses POP3 accounts, as Nexus has the only copy.)
      const lockedAccounts = await db.account.findMany({
        where: { ownerId: user.id, protocol: 'imap', messages: { some: { sealedBody: { not: null } } } },
        select: { id: true },
      })
      const accountIds = lockedAccounts.map((a) => a.id)
      await db.$transaction([
        db.message.deleteMany({ where: { accountId: { in: accountIds } } }),
        // A folder with no sync history downloads its recent mail again on the next sync.
        db.folder.updateMany({
          where: { accountId: { in: accountIds } },
          data: { uidValidity: null, lastUid: 0, oldestUid: null },
        }),
        db.user.update({
          where: { id: user.id },
          // The old keys are locked with the old password, so they're useless now. Private storage is
          // off until the user turns it on again with their new password.
          data: {
            passwordHash: await hashPassword(password),
            privateStorage: false,
            storagePrivateKey: null,
            storagePublicKey: null,
          },
        }),
        // Copies of the old key that passkeys unlock (see auth/passkeys.ts) are useless now too.
        db.passkey.updateMany({ where: { userId: user.id }, data: { storageKey: null } }),
        db.session.deleteMany({ where: { userId: user.id } }),
      ])
      for (const id of accountIds) await queueSync(id)
      return { ok: true, redownloading: accountIds.length }
    })

    // For someone who lost both their phone and their recovery codes.
    admin.delete<{ Params: { id: string } }>('/:id/2fa', async (request) => {
      await db.user.update({
        where: { id: request.params.id },
        data: { totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: [] },
      })
      return { ok: true }
    })

    admin.delete<{ Params: { id: string } }>('/:id', async (request) => {
      if (request.params.id === request.user.id) throw badRequest('You cannot delete yourself')
      await db.user.delete({ where: { id: request.params.id } })
      return { ok: true }
    })
  })
}
