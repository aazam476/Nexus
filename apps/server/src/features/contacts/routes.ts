// The address book.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { notFound, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { parseVcards, toVcards } from './vcard.ts'

const contactFields = z.object({
  name: z.string().trim().min(1),
  emails: z.array(z.string().trim().toLowerCase().email()).min(1),
  phone: z.string().trim().optional(),
  company: z.string().trim().optional(),
  pgpPublicKey: z.string().optional(),
  pgpFingerprint: z.string().optional(),
})

export async function contactRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/contacts', async (request) => {
    const { q } = parse(z.object({ q: z.string().trim().optional() }), request.query)
    // Prisma can only match whole array items, so find address matches ("github", "okafor.dev") in SQL.
    const byEmail = q
      ? (
          await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Contact" WHERE "userId" = ${request.user.id} AND array_to_string(emails, ' ') ILIKE ${'%' + q + '%'}`
        ).map((c) => c.id)
      : []
    return db.contact.findMany({
      where: {
        userId: request.user.id,
        ...(q && {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { id: { in: byEmail } },
            { company: { contains: q, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: [{ messageCount: 'desc' }, { name: 'asc' }],
      take: q ? 10 : 2000,
      omit: { smimeCert: true },
    })
  })

  app.post('/contacts', async (request) => {
    const body = parse(contactFields, request.body)
    return db.contact.create({ data: { ...body, userId: request.user.id } })
  })

  app.patch<{ Params: { id: string } }>('/contacts/:id', async (request) => {
    const body = parse(contactFields.partial(), request.body)
    const updated = await db.contact.updateMany({
      where: { id: request.params.id, userId: request.user.id },
      data: body,
    })
    if (!updated.count) throw notFound('Contact')
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/contacts/:id', async (request) => {
    await db.contact.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
    return { ok: true }
  })

  app.get('/contacts/export.vcf', async (request, reply) => {
    const contacts = await db.contact.findMany({ where: { userId: request.user.id }, orderBy: { name: 'asc' } })
    const vcf = toVcards(
      contacts.map((c) => ({
        name: c.name,
        emails: c.emails,
        phone: c.phone ?? undefined,
        company: c.company ?? undefined,
      })),
    )
    return reply
      .header('content-type', 'text/vcard; charset=utf-8')
      .header('content-disposition', 'attachment; filename="nexus-contacts.vcf"')
      .send(vcf)
  })

  // Body is the .vcf text. Contacts whose email already exists are merged, not duplicated.
  app.post('/contacts/import', async (request) => {
    const { vcf } = parse(z.object({ vcf: z.string().max(10_000_000) }), request.body)
    let added = 0
    for (const card of parseVcards(vcf)) {
      const existing = await db.contact.findFirst({
        where: { userId: request.user.id, emails: { hasSome: card.emails } },
      })
      if (existing) {
        await db.contact.update({
          where: { id: existing.id },
          data: {
            emails: [...new Set([...existing.emails, ...card.emails])],
            phone: existing.phone ?? card.phone,
            company: existing.company ?? card.company,
          },
        })
      } else {
        await db.contact.create({ data: { ...card, userId: request.user.id } })
        added++
      }
    }
    return { added }
  })
}
