// PGP keys and S/MIME certificates.
// PGP happens in the browser: the server only stores public keys and passphrase-locked private keys.
// S/MIME happens on the server (see send/smime.ts), so the certificate's private key is stored encrypted.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { encrypt } from '../../lib/crypto.ts'
import { badRequest, parse } from '../../lib/http.ts'
import { requireUser } from '../../lib/session.ts'
import { readP12 } from '../send/smime.ts'

export async function encryptionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/pgp/keys', async (request) =>
    db.pgpKey.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'asc' } }),
  )

  // The browser generates or imports the key, locks the private half with the user's passphrase, then uploads both.
  app.post('/pgp/keys', async (request) => {
    const body = parse(
      z.object({
        fingerprint: z.string().regex(/^[0-9A-F]{40,64}$/i),
        userIds: z.array(z.string()),
        publicKey: z.string().includes('BEGIN PGP PUBLIC KEY BLOCK'),
        encryptedPrivateKey: z.string().includes('BEGIN PGP PRIVATE KEY BLOCK'),
      }),
      request.body,
    )
    const isDefault = (await db.pgpKey.count({ where: { userId: request.user.id } })) === 0
    return db.pgpKey.create({
      data: { ...body, fingerprint: body.fingerprint.toUpperCase(), userId: request.user.id, isDefault },
    })
  })

  app.post<{ Params: { id: string } }>('/pgp/keys/:id/default', async (request) => {
    await db.$transaction([
      db.pgpKey.updateMany({ where: { userId: request.user.id }, data: { isDefault: false } }),
      db.pgpKey.updateMany({ where: { id: request.params.id, userId: request.user.id }, data: { isDefault: true } }),
    ])
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/pgp/keys/:id', async (request) => {
    await db.pgpKey.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
    return { ok: true }
  })

  // Public keys to encrypt to: your contacts' keys plus your own (so you can read what you sent).
  app.post('/pgp/recipients', async (request) => {
    const { emails } = parse(z.object({ emails: z.array(z.string().toLowerCase()) }), request.body)
    const contacts = await db.contact.findMany({
      where: { userId: request.user.id, emails: { hasSome: emails }, pgpPublicKey: { not: null } },
    })
    const own = await db.pgpKey.findFirst({ where: { userId: request.user.id, isDefault: true } })
    return {
      keys: Object.fromEntries(
        emails.map((email) => [email, contacts.find((c) => c.emails.includes(email))?.pgpPublicKey ?? null]),
      ),
      ownKey: own?.publicKey ?? null,
    }
  })

  // ---------- S/MIME ----------

  app.get('/smime', async (request) =>
    db.smimeCert.findMany({
      where: { userId: request.user.id },
      select: { id: true, email: true, subject: true, expiresAt: true, createdAt: true },
    }),
  )

  app.post('/smime', { bodyLimit: 2 * 1024 * 1024 }, async (request) => {
    const body = parse(z.object({ p12: z.string(), password: z.string() }), request.body) // p12 as base64
    const cert = await readP12(Buffer.from(body.p12, 'base64'), body.password)
    if (!cert.email) throw badRequest('The certificate has no email address in it')
    if (cert.expiresAt < new Date()) throw badRequest('This certificate has expired')
    await db.smimeCert.create({
      data: {
        userId: request.user.id,
        email: cert.email,
        subject: cert.subject,
        certPem: cert.certPem,
        keyPem: encrypt(cert.keyPem),
        expiresAt: cert.expiresAt,
      },
    })
    return { email: cert.email, subject: cert.subject, expiresAt: cert.expiresAt }
  })

  app.delete<{ Params: { id: string } }>('/smime/:id', async (request) => {
    await db.smimeCert.deleteMany({ where: { id: request.params.id, userId: request.user.id } })
    return { ok: true }
  })
}
