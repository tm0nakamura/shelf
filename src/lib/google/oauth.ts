import { env } from '@/lib/env'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
] as const

export const GMAIL_REDIRECT_URI = `${env.APP_URL}/api/gmail/callback`

export type GoogleTokens = {
  access_token: string
  refresh_token: string
  expires_at: number  // unix epoch (seconds)
  scope: string
}

function requireKeys() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
  }
  return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
}

export function buildAuthorizeUrl(state: string) {
  const { id } = requireKeys()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    scope: GMAIL_SCOPES.join(' '),
    redirect_uri: GMAIL_REDIRECT_URI,
    state,
    access_type: 'offline',     // request refresh_token
    prompt: 'consent',          // force re-consent so refresh_token is always returned
    include_granted_scopes: 'true',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const { id, secret } = requireKeys()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: GMAIL_REDIRECT_URI,
    client_id: id,
    client_secret: secret,
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`)
  }
  const json = await res.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
  }
  if (!json.refresh_token) {
    throw new Error('Google did not return a refresh_token. Re-consent with prompt=consent.')
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
    scope: json.scope,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const { id, secret } = requireKeys()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`)
  }
  const json = await res.json() as {
    access_token: string
    expires_in: number
    scope: string
  }
  return {
    access_token: json.access_token,
    refresh_token: refreshToken,  // refresh tokens don't change unless revoked
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
    scope: json.scope,
  }
}

export function isExpiringSoon(tokens: GoogleTokens, marginSec = 60): boolean {
  return tokens.expires_at <= Math.floor(Date.now() / 1000) + marginSec
}
