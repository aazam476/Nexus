// S/MIME, done by the `openssl` command line tool (installed in the Docker image).
// Keys are written to a private temp folder only for the length of one command.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpError } from '../../lib/http.ts'

interface Files {
  [name: string]: string | Buffer
}

// Runs openssl with the given files available in a temp folder. Returns stdout, or a named output file.
async function openssl(
  args: (dir: string) => string[],
  files: Files,
  options: { env?: Record<string, string>; output?: string } = {},
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-smime-'))
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content, { mode: 0o600 })
    const stdout = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        'openssl',
        args(dir),
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...options.env } },
        (error, out, err) => {
          if (error) reject(new Error(err.toString().trim() || error.message))
          else resolve(out)
        },
      )
    })
    return options.output ? await readFile(join(dir, options.output)) : stdout
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Reads an uploaded .p12/.pfx. The password goes through an environment variable, not the command line.
export async function readP12(p12: Buffer, password: string) {
  const unpack = (legacy: boolean) =>
    openssl(
      (d) => [
        'pkcs12',
        '-in',
        join(d, 'id.p12'),
        '-nodes',
        '-passin',
        'env:P12_PASSWORD',
        ...(legacy ? ['-legacy'] : []),
      ],
      { 'id.p12': p12 },
      { env: { P12_PASSWORD: password } },
    )
  // Older certificate files use ciphers OpenSSL 3 only reads with -legacy.
  const pem = (
    await unpack(false)
      .catch(() => unpack(true))
      .catch(() => {
        throw new HttpError(400, 'Could not open the certificate. Check the password.')
      })
  ).toString()

  const certPem = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0]
  const keyPem = pem.match(
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/,
  )?.[0]
  if (!certPem || !keyPem) throw new HttpError(400, 'The file must contain both a certificate and its private key')

  const info = (
    await openssl((d) => ['x509', '-in', join(d, 'cert.pem'), '-noout', '-subject', '-enddate', '-email'], {
      'cert.pem': certPem,
    })
  ).toString()
  const subject = info.match(/subject=\s*(.+)/)?.[1]?.trim() ?? ''
  const expiresAt = new Date(info.match(/notAfter=(.+)/)?.[1] ?? '')
  const email =
    info
      .split('\n')
      .find((line) => line.includes('@') && !line.includes('='))
      ?.trim()
      .toLowerCase() ??
    subject.match(/emailAddress\s*=\s*([^,/]+)/)?.[1]?.toLowerCase() ??
    ''
  return { certPem, keyPem, subject, email, expiresAt }
}

// Signs a MIME entity. Output is a multipart/signed entity (detached signature, readable everywhere).
export function sign(entity: Buffer, certPem: string, keyPem: string): Promise<Buffer> {
  return openssl(
    (d) => [
      'smime',
      '-sign',
      '-in',
      join(d, 'entity'),
      '-signer',
      join(d, 'cert.pem'),
      '-inkey',
      join(d, 'key.pem'),
      '-crlfeol',
    ],
    { entity, 'cert.pem': certPem, 'key.pem': keyPem },
  )
}

// Encrypts a MIME entity for the given recipient certificates (always include the sender's own).
export function encrypt(entity: Buffer, recipientCerts: string[]): Promise<Buffer> {
  const certs = Object.fromEntries(recipientCerts.map((pem, i) => [`r${i}.pem`, pem]))
  return openssl(
    (d) => [
      'smime',
      '-encrypt',
      '-aes256',
      '-in',
      join(d, 'entity'),
      '-crlfeol',
      ...recipientCerts.map((_, i) => join(d, `r${i}.pem`)),
    ],
    { entity, ...certs },
  )
}

export function decrypt(raw: Buffer, certPem: string, keyPem: string): Promise<Buffer> {
  return openssl(
    (d) => ['smime', '-decrypt', '-in', join(d, 'msg'), '-recip', join(d, 'cert.pem'), '-inkey', join(d, 'key.pem')],
    { msg: raw, 'cert.pem': certPem, 'key.pem': keyPem },
  )
}

// Checks a signature.
//   trusted   – intact, and the certificate comes from a CA this system trusts
//   untrusted – intact (nobody changed the mail), but the certificate is self-signed or from an unknown CA
//   invalid   – the mail was changed after signing, or the signature is broken
export async function verify(
  raw: Buffer,
): Promise<{ status: 'trusted' | 'untrusted' | 'invalid'; signerPem?: string }> {
  const check = (extra: string[]) =>
    openssl(
      (d) => [
        'smime',
        '-verify',
        '-in',
        join(d, 'msg'),
        '-signer',
        join(d, 'signer.pem'),
        '-out',
        join(d, 'content'),
        ...extra,
      ],
      { msg: raw },
      { output: 'signer.pem' },
    )
  try {
    return { status: 'trusted', signerPem: (await check([])).toString() }
  } catch {
    try {
      return { status: 'untrusted', signerPem: (await check(['-noverify'])).toString() }
    } catch {
      return { status: 'invalid' }
    }
  }
}
