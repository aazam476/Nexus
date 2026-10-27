// An integration test only because connect.ts reads the server's configuration when it loads.
import { describe, expect, it } from 'vitest'
import { encrypt } from '../../lib/crypto.ts'
import { sendingCredentials } from './connect.ts'

const account = {
  id: 'a1',
  auth: 'password',
  username: 'ann@home.test',
  secret: encrypt('receiving password'),
  inHost: 'imap.home.test',
  inPort: 993,
  inTls: true,
  smtpHost: 'smtp.relay.test',
  smtpPort: 465,
  smtpTls: true,
  smtpUsername: null as string | null,
  smtpSecret: null as string | null,
}

describe('sendingCredentials', () => {
  it('uses the receiving login when there is no separate one', async () => {
    expect(await sendingCredentials(account)).toEqual({ user: 'ann@home.test', pass: 'receiving password' })
  })

  it('uses the separate sending login when the account has one', async () => {
    const relay = { ...account, smtpUsername: 'relay-user', smtpSecret: encrypt('relay key') }
    expect(await sendingCredentials(relay)).toEqual({ user: 'relay-user', pass: 'relay key' })
  })
})
