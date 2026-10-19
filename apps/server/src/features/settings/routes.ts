// Rules, blocked senders and labels.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { notFound, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'

const ruleFields = z.object({
  name: z.string().trim().min(1),
  field: z.enum(['from', 'to', 'subject', 'body']),
  contains: z.string().trim().min(1),
  action: z.enum(['label', 'move', 'category', 'mark-read', 'spam']),
  value: z.string().trim().nullish(),
  enabled: z.boolean().default(true),
})

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  // ---------- Rules ----------

  app.get('/rules', async (request) => db.rule.findMany({ where: { userId: request.user.id }, orderBy: { position: 'asc' } }))

  app.post('/rules', async (request) => {
    const body = parse(ruleFields, request.body)
    const position = await db.rule.count({ where: { userId: request.user.id } })
    return db.rule.create({ data: { ...body, userId: request.user.id, position } })
  })

  app.patch<{ Params: { id: string } }>('/rules/:id', async (request) => {
    const body = parse(ruleFields.partial(), request.body)
    const updated = await db.rule.updateMany({ where: { id: request.params.id, userId: request.user.id }, data: body })
    if (!updated.count) throw notFound('Rule')
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/rules/:id', async (request) => {
    await db.rule.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
    return { ok: true }
  })

  // ---------- Blocked senders ----------

  app.get('/blocked', async (request) => (await db.blockedSender.findMany({ where: { userId: request.user.id } })).map((b) => b.pattern))

  app.post('/blocked', async (request) => {
    const { pattern } = parse(z.object({ pattern: z.string().trim().toLowerCase().min(3).regex(/^[^\s]+\.[^\s]+$/, 'Enter an address or a domain') }), request.body)
    const key = { userId: request.user.id, pattern: pattern.replace(/^@/, '') }
    await db.blockedSender.upsert({ where: { userId_pattern: key }, create: key, update: {} })
    return { ok: true }
  })

  app.delete<{ Params: { pattern: string } }>('/blocked/:pattern', async (request) => {
    await db.blockedSender.deleteMany({ where: { userId: request.user.id, pattern: request.params.pattern } })
    return { ok: true }
  })

  // ---------- Labels ----------

  app.get('/labels', async (request) => db.label.findMany({ where: { userId: request.user.id }, orderBy: { name: 'asc' } }))

  app.put('/labels', async (request) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-f]{6}$/i) }), request.body)
    const key = { userId: request.user.id, name: body.name }
    await db.label.upsert({ where: { userId_name: key }, create: { ...key, color: body.color }, update: { color: body.color } })
    return { ok: true }
  })

  app.delete<{ Params: { name: string } }>('/labels/:name', async (request) => {
    await db.label.deleteMany({ where: { userId: request.user.id, name: request.params.name } })
    return { ok: true }
  })
}
