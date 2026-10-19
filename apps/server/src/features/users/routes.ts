// Users on this server. Admins manage them; everyone can see the directory to share accounts.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { hashPassword } from '../../lib/crypto.ts'
import { badRequest, parse } from '../../lib/http.ts'
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
      return users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, totpEnabled: u.totpEnabled }))
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
      if (await db.user.findUnique({ where: { email: body.email } })) throw badRequest('That email is already registered')
      const user = await db.user.create({ data: { name: body.name, email: body.email, role: body.role, passwordHash: await hashPassword(body.password) } })
      return { id: user.id }
    })

    admin.patch<{ Params: { id: string } }>('/:id', async (request) => {
      const { role } = parse(z.object({ role: z.enum(['admin', 'user']) }), request.body)
      if (request.params.id === request.user.id && role !== 'admin') throw badRequest('You cannot remove your own admin role')
      await db.user.update({ where: { id: request.params.id }, data: { role } })
      return { ok: true }
    })

    admin.delete<{ Params: { id: string } }>('/:id', async (request) => {
      if (request.params.id === request.user.id) throw badRequest('You cannot delete yourself')
      await db.user.delete({ where: { id: request.params.id } })
      return { ok: true }
    })
  })
}
