import { env, SPOTIFY_REDIRECT_URI } from '@/lib/env'

export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-library-read',
] as const

export type SpotifyTokens = {
  access_token: string
  refresh_token: string
  expires_at: number  // unix epoch (seconds)
  scope: string
}

function requireKeys() {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials are not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.')
  }
  return { id: env.SPOTIFY_CLIENT_ID, secret: env.SPOTIFY_CLIENT_SECRET }
}

export function buildAuthorizeUrl(state: string) {
  const { id } = requireKeys()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
  })
  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string): Promise<SpotifyTokens> {
  const { id, secret } = requireKeys()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`)
  }
  const json = await res.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
    scope: json.scope,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const { id, secret } = requireKeys()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status} ${await res.text()}`)
  }
  const json = await res.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,  // Spotify often omits on refresh
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
    scope: json.scope,
  }
}

export function isExpiringSoon(tokens: SpotifyTokens, marginSec = 60): boolean {
  return tokens.expires_at <= Math.floor(Date.now() / 1000) + marginSec
}
