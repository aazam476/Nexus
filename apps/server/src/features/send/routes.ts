// Sending, scheduling, and drafts.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { cancelSend, scheduleSend } from '../../jobs/queue.ts'
import { requireAccountRole } from '../../lib/access.ts'
import { badRequest, notFound, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { outgoingSchema, sendNow } from './send.ts'

export async function sendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  // Send now, or later when `scheduledFor` is in the future. `draftId` removes the draft it came from.
  app.post('/send', { bodyLimit: 30 * 1024 * 1024 }, async (request) => {
    const body = parse(outgoingSchema.extend({ scheduledFor: z.coerce.date().optional(), draftId: z.string().optional() }), request.body)
    const { scheduledFor, draftId, ...payload } = body
    await requireAccountRole(request.user.id, payload.accountId, 'editor')

    if (scheduledFor && scheduledFor.getTime() > Date.now() + 30_000) {
      const outgoing = await db.outgoingMessage.create({ data: { userId: request.user.id, accountId: payload.accountId, status: 'scheduled', payload, scheduledFor } })
      await scheduleSend(outgoing.id, scheduledFor)
      if (draftId) await db.outgoingMessage.deleteMany({ where: { id: draftId, userId: request.user.id, status: 'draft' } })
      return { scheduled: true, id: outgoing.id }
    }

    await sendNow(request.user.id, payload)
    if (draftId) await db.outgoingMessage.deleteMany({ where: { id: draftId, userId: request.user.id, status: 'draft' } })
    return { sent: true }
  })

  // Save (or update) a draft. Recipients may be incomplete, so they are not validated as emails here.
  app.put('/drafts', { bodyLimit: 30 * 1024 * 1024 }, async (request) => {
    const body = parse(
      outgoingSchema.extend({ id: z.string().optional(), to: z.array(z.string()).default([]), cc: z.array(z.string()).default([]), bcc: z.array(z.string()).default([]) }),
      request.body,
    )
    const { id, ...payload } = body
    await requireAccountRole(request.user.id, payload.accountId, 'editor')
    if (id) {
      const updated = await db.outgoingMessage.updateMany({ where: { id, userId: request.user.id, status: 'draft' }, data: { payload, accountId: payload.accountId } })
      if (updated.count) return { id }
    }
    const draft = await db.outgoingMessage.create({ data: { userId: request.user.id, accountId: payload.accountId, status: 'draft', payload } })
    return { id: draft.id }
  })

  // Discard a draft, or cancel a scheduled send.
  app.delete<{ Params: { id: string } }>('/outgoing/:id', async (request) => {
    const outgoing = await db.outgoingMessage.findFirst({ where: { id: request.params.id, userId: request.user.id } })
    if (!outgoing) throw notFound('Message')
    if (outgoing.status === 'sending') throw badRequest('It is being sent right now')
    await cancelSend(outgoing.id)
    await db.outgoingMessage.delete({ where: { id: outgoing.id } })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/outgoing/:id/send-now', async (request) => {
    const outgoing = await db.outgoingMessage.findFirst({ where: { id: request.params.id, userId: request.user.id, status: { in: ['scheduled', 'failed'] } } })
    if (!outgoing) throw notFound('Scheduled message')
    await cancelSend(outgoing.id)
    await sendNow(request.user.id, outgoingSchema.parse(outgoing.payload))
    await db.outgoingMessage.delete({ where: { id: outgoing.id } })
    return { sent: true }
  })
}
