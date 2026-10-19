// "Sign in with Google / Microsoft" for mail accounts (OAuth2 authorization code flow).
// Nexus keeps the refresh token (encrypted) and mints short-lived access tokens for IMAP and SMTP.
import { config } from '../../config.ts'
import { decrypt } from '../../lib/crypto.ts'
import { HttpError } from '../../lib/http.ts'

export const providers = {
  google: {
    auth: 'oauth-google',
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile https://mail.google.com/',
    extraParams: { access_type: 'offline', prompt: 'consent' },
    servers: { inHost: 'imap.gmail.com', inPort: 993, inTls: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpTls: true },
  },
  microsoft: {
    auth: 'oauth-microsoft',
    clientId: config.MICROSOFT_CLIENT_ID,
    clientSecret: config.MICROSOFT_CLIENT_SECRET,
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    extraParams: {},
    servers: { inHost: 'outlook.office365.com', inPort: 993, inTls: true, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpTls: false },
  },
} as const

export type ProviderName = keyof typeof providers

export function getProvider(name: string) {
  const provider = providers[name as ProviderName]
  if (!provider) throw new HttpError(404, 'Unknown sign-in provider')
  if (!provider.clientId || !provider.clientSecret) throw new HttpError(400, `${name} sign-in is not set up on this server. An admin needs to add its client ID and secret.`)
  return provider
}

export const redirectUri = (name: string) => `${config.PUBLIC_URL}/api/oauth/${name}/callback`

export function authorizeUrl(name: string, state: string): string {
  const provider = getProvider(name)
  const params = new URLSearchParams({
    client_id: provider.clientId!,
    redirect_uri: redirectUri(name),
    response_type: 'code',
    scope: provider.scope,
    state,
    ...provider.extraParams,
  })
  return `${provider.authorizeUrl}?${params}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
}

async function tokenRequest(name: string, params: Record<string, string>): Promise<TokenResponse> {
  const provider = getProvider(name)
  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: provider.clientId!, client_secret: provider.clientSecret!, ...params }),
  })
  if (!response.ok) throw new HttpError(502, `${name} sign-in failed: ${await response.text()}`)
  return response.json() as Promise<TokenResponse>
}

export async function exchangeCode(name: string, code: string) {
  const tokens = await tokenRequest(name, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(name) })
  if (!tokens.refresh_token) throw new HttpError(502, 'The provider did not return a refresh token. Remove Nexus from your account’s connected apps and try again.')
  // The ID token came straight from the provider over TLS, so reading it without verifying the signature is safe here.
  const claims = JSON.parse(Buffer.from(tokens.id_token?.split('.')[1] ?? '', 'base64url').toString() || '{}')
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase()
  if (!email) throw new HttpError(502, 'The provider did not say which email address you signed in with')
  return { email, name: String(claims.name ?? email), refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresIn: tokens.expires_in }
}

// Access tokens live about an hour. Keep them in memory and refresh a minute early.
const cache = new Map<string, { token: string; expiresAt: number }>()

export async function accessToken(account: { id: string; auth: string; secret: string }): Promise<string> {
  const cached = cache.get(account.id)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const name = account.auth === 'oauth-google' ? 'google' : 'microsoft'
  const tokens = await tokenRequest(name, { grant_type: 'refresh_token', refresh_token: decrypt(account.secret) })
  cache.set(account.id, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 })
  return tokens.access_token
}
