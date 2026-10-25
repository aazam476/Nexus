import { describe, expect, it } from 'vitest'
import { completeMultiline, unstuff } from './pop3.ts'

const reply = (s: string) => Buffer.from(s, 'latin1')

describe('POP3 multi-line replies', () => {
  it('keeps lines that start with a dot, removing only the stuffed dot', () => {
    const done = completeMultiline(reply('+OK 40 octets\r\nline one\r\n..starts with a dot\r\n...two\r\nend\r\n.\r\n'))
    expect(done?.body.toString()).toBe('line one\r\n.starts with a dot\r\n..two\r\nend\r\n')
  })

  it('waits until the terminating line has arrived', () => {
    expect(completeMultiline(reply('+OK\r\nline one\r\n.start'))).toBeNull()
    expect(completeMultiline(reply('+OK\r\nline one\r\n'))).toBeNull()
  })

  it('handles an empty reply and keeps what follows for the next one', () => {
    const done = completeMultiline(reply('+OK\r\n.\r\n+OK next'))
    expect(done?.body.length).toBe(0)
    expect(done?.rest.toString()).toBe('+OK next')
  })

  it('leaves 8-bit bytes alone', () => {
    expect([...unstuff(Buffer.from([0x2e, 0x2e, 0xe9, 0xff]))]).toEqual([0x2e, 0xe9, 0xff])
  })
})

// A tiny POP3 server, enough to drive the client through a whole session, including the
// STLS upgrade from a plain connection to TLS (which the GreenMail test server doesn't offer).
describe('POP3 client against a server', async () => {
  const { createServer } = await import('node:net')
  const { TLSSocket } = await import('node:tls')
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Pop3 } = await import('./pop3.ts')

  // A throwaway self-signed certificate for the fake server.
  const dir = mkdtempSync(join(tmpdir(), 'pop3-test-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  const tlsOptions = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }
  rmSync(dir, { recursive: true, force: true })

  const mailbox = ['Subject: One\r\n\r\nfirst\r\n', 'Subject: Two\r\n\r\n.a line with a dot\r\n']
  const deleted: number[] = []
  const commands: string[] = []

  const server = createServer((plain) => {
    let socket: import('node:net').Socket = plain
    const send = (line: string) => socket.write(line + '\r\n')
    const listen = (s: import('node:net').Socket) => {
      let buffer = ''
      s.on('data', (chunk) => {
        buffer += chunk.toString('latin1')
        let end
        while ((end = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          commands.push(line.startsWith('PASS') ? 'PASS ***' : line)
          const [verb, arg] = line.split(' ')
          if (verb === 'STLS') {
            send('+OK begin TLS')
            s.removeAllListeners('data')
            socket = new TLSSocket(plain, { isServer: true, ...tlsOptions })
            listen(socket)
          } else if (verb === 'USER') send('+OK')
          else if (verb === 'PASS') send(arg === 'right' ? '+OK logged in' : '-ERR [AUTH] Wrong password')
          else if (verb === 'UIDL') send(`+OK\r\n${mailbox.map((_, i) => `${i + 1} uid-${i + 1}`).join('\r\n')}\r\n.`)
          else if (verb === 'RETR') send(`+OK\r\n${mailbox[Number(arg) - 1].replace(/^\./gm, '..')}.`)
          else if (verb === 'DELE') { deleted.push(Number(arg)); send('+OK') }
          else if (verb === 'QUIT') { send('+OK bye'); s.end() }
          else send('-ERR unknown command')
        }
      })
    }
    listen(plain)
    send('+OK fake POP3 ready')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const settings = { host: '127.0.0.1', port, tls: false, user: 'ann', password: 'right', tlsOptions: { rejectUnauthorized: false } }

  it('upgrades to TLS with STLS, lists, downloads, deletes and quits', async () => {
    const pop3 = await Pop3.open(settings)
    expect(await pop3.uidl()).toEqual([[1, 'uid-1'], [2, 'uid-2']])
    expect((await pop3.retrieve(2)).toString()).toBe('Subject: Two\r\n\r\n.a line with a dot\r\n')
    await pop3.delete(1)
    await pop3.quit()
    expect(deleted).toEqual([1])
    expect(commands).toEqual(['STLS', 'USER ann', 'PASS ***', 'UIDL', 'RETR 2', 'DELE 1', 'QUIT'])
  })

  it('passes on the server’s reason when it refuses', async () => {
    await expect(Pop3.open({ ...settings, password: 'wrong' })).rejects.toThrow('[AUTH] Wrong password')
  })

  it('fails clearly when nothing is listening', async () => {
    await expect(Pop3.open({ ...settings, port: 1 })).rejects.toThrow()
    server.close()
  })
})
