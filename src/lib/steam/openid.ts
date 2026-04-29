import 'server-only'
import { env } from '@/lib/env'

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'

/**
 * Build the URL we redirect the user to so they can sign in with Steam.
 * Steam implements OpenID 2.0 (no client registration / no app secret).
 * On success Steam bounces back to `returnTo` with the SteamID embedded
 * in `openid.claimed_id`.
 */
export function buildAuthorizeUrl(returnTo: string): string {
  const realm = new URL(returnTo).origin
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`
}

/**
 * Verify the OpenID response Steam sent us. We re-POST every openid.*
 * parameter back to Steam with `mode=check_authentication` and confirm
 * the body contains `is_valid:true` before trusting the claimed SteamID.
 *
 * Returns the 17-digit SteamID64 on success, null on any failure.
 */
export async function verifyOpenIdReturn(input: URLSearchParams): Promise<string | null> {
  // Quick mode check.
  if (input.get('openid.mode') !== 'id_res') return null

  // Extract SteamID from claimed_id.
  const claimedId = input.get('openid.claimed_id') ?? ''
  const m = claimedId.match(/\/openid\/id\/(\d{17})$/)
  if (!m) return null
  const steamId = m[1]

  // Re-send everything to Steam, swapping mode to check_authentication.
  const verify = new URLSearchParams()
  for (const [k, v] of input.entries()) {
    if (k.startsWith('openid.')) verify.set(k, v)
  }
  verify.set('openid.mode', 'check_authentication')

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verify.toString(),
  })
  if (!res.ok) return null
  const text = await res.text()
  if (!/is_valid\s*:\s*true/i.test(text)) return null
  return steamId
}

/** A handy guard so route handlers don't have to remember the env name. */
export function ensureSteamConfigured(): void {
  if (!env.STEAM_API_KEY) {
    throw new Error('STEAM_API_KEY is not configured')
  }
}
