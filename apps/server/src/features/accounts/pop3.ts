// A small POP3 client (RFC 1939): just what Nexus needs, nothing more.
// We use our own because the node-pop3 library ends a message at the first line starting
// with a dot, silently cutting the rest of the mail off.
import { connect as connectTcp, isIP, type Socket } from 'node:net'
import { connect as connectTls, type ConnectionOptions } from 'node:tls'

const TIMEOUT = 30_000

// Multi-line POP3 replies end with a line holding only ".", and every line that starts with
// a dot gets an extra one in front ("dot-stuffing"). These two helpers undo that.
const TERMINATOR = Buffer.from('\r\n.\r\n')

// Given everything received so far for a multi-line reply, returns its body once the whole reply has arrived.
export function completeMultiline(received: Buffer): { body: Buffer; rest: Buffer } | null {
  const firstLineEnd = received.indexOf('\r\n')
  if (firstLineEnd === -1) return null
  // Search from the first line's own CRLF, so an empty body ("+OK\r\n.\r\n") is found too.
  const end = received.indexOf(TERMINATOR, firstLineEnd)
  if (end === -1) return null
  const body = end === firstLineEnd ? Buffer.alloc(0) : received.subarray(firstLineEnd + 2, end + 2)
  return { body: unstuff(body), rest: received.subarray(end + TERMINATOR.length) }
}

export function unstuff(body: Buffer): Buffer {
  // latin1 maps bytes 1:1, so 8-bit mail passes through untouched.
  return Buffer.from(body.toString('latin1').replace(/(^|\r\n)\./g, '$1'), 'latin1')
}

export interface Pop3Settings {
  host: string
  port: number
  tls: boolean // true = TLS from the start, false = upgrade with STLS
  user: string
  password: string
  tlsOptions?: ConnectionOptions
}

export class Pop3 {
  private socket!: Socket
  private received: Buffer = Buffer.alloc(0)
  private notify: (() => void) | null = null
  private failure: Error | null = null

  static async open(settings: Pop3Settings): Promise<Pop3> {
    const pop3 = new Pop3()
    // The server name tells TLS which certificate to expect. It must be a host name, never an IP address.
    const tlsOptions = {
      host: settings.host,
      port: settings.port,
      ...(!isIP(settings.host) && { servername: settings.host }),
      ...settings.tlsOptions,
    }
    pop3.attach(settings.tls ? connectTls(tlsOptions) : connectTcp(settings.port, settings.host))
    await pop3.reply() // greeting
    if (!settings.tls) {
      await pop3.command('STLS')
      pop3.attach(connectTls({ ...tlsOptions, socket: pop3.socket }))
    }
    await pop3.command(`USER ${settings.user}`)
    await pop3.command(`PASS ${settings.password}`)
    return pop3
  }

  // [message number, unique id] for every message on the server.
  async uidl(): Promise<[number, string][]> {
    const lines = (await this.command('UIDL', true)).toString('latin1').split('\r\n').filter(Boolean)
    return lines.map((line) => {
      const [number, uid] = line.split(' ')
      return [Number(number), uid]
    })
  }

  retrieve(number: number): Promise<Buffer> {
    return this.command(`RETR ${number}`, true)
  }

  async delete(number: number) {
    await this.command(`DELE ${number}`)
  }

  async quit() {
    await this.command('QUIT').catch(() => undefined)
    this.socket.end()
  }

  private attach(socket: Socket) {
    this.socket = socket
    socket.setTimeout(TIMEOUT, () => socket.destroy(new Error('The POP3 server stopped responding')))
    socket.on('data', (chunk: Buffer) => {
      this.received = Buffer.concat([this.received, chunk])
      this.notify?.()
    })
    socket.on('error', (error) => {
      this.failure = error
      this.notify?.()
    })
  }

  private async command(line: string, multiline = false): Promise<Buffer> {
    this.socket.write(`${line}\r\n`)
    return this.reply(multiline)
  }

  private async reply(multiline = false): Promise<Buffer> {
    for (;;) {
      if (this.failure) throw this.failure
      const lineEnd = this.received.indexOf('\r\n')
      if (lineEnd !== -1) {
        const status = this.received.subarray(0, lineEnd).toString('latin1')
        if (!status.startsWith('+OK')) {
          this.received = this.received.subarray(lineEnd + 2)
          throw new Error(status.replace(/^-ERR\s*/, '') || 'The POP3 server refused the command')
        }
        if (!multiline) {
          this.received = this.received.subarray(lineEnd + 2)
          return Buffer.alloc(0)
        }
        const done = completeMultiline(this.received)
        if (done) {
          this.received = done.rest
          return done.body
        }
      }
      await new Promise<void>((resolve) => (this.notify = resolve))
    }
  }
}
