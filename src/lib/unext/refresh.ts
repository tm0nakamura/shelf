import 'server-only'

/**
 * U-NEXT access-token rotation. The web client autorefreshes silently
 * when `_at` nears expiry; we replicate that so the user doesn't have
 * to re-paste their cookies every 11 hours.
 *
 * We don't have an officially-documented refresh endpoint, so this
 * tries paths in the order most likely to hit:
 *
 *   1. POST oauth.unext.jp/oauth/token  (RFC 6749 standard)
 *   2. POST oauth.unext.jp/token
 *   3. POST oauth.unext.jp/v1/token
 *
 * On the first 2xx with a JSON access_token we cache nothing — the
 * caller writes the new cookie back to the connection record. On
 * total failure we surface the last error so the UI can nudge the
 * user toward a manual re-paste.
 */

const REFRESH_ENDPOINTS = [
  'https://oauth.unext.jp/oauth/token',
  'https://oauth.unext.jp/token',
  'https://oauth.unext.jp/v1/token',
] as const

const CLIENT_ID = 'unext'

export type RefreshResult = {
  accessToken: string
  /** U-NEXT may rotate the refresh token; if so we need to persist the new one. */
  refreshToken?: string | null
  expiresAt: number
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  if (!refreshToken) throw new Error('refresh_token_missing')

  const errs: string[] = []
  for (const url of REFRESH_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://video.unext.jp',
          referer: 'https://video.unext.jp/',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CLIENT_ID,
        }).toString(),
      })

      if (!r.ok) {
        const body = await r.text().catch(() => '')
        errs.push(`${url} → ${r.status}: ${body.slice(0, 120)}`)
        continue
      }

      const json = (await r.json().catch(() => null)) as
        | { access_token?: string; refresh_token?: string; expires_in?: number }
        | null
      if (!json?.access_token) {
        errs.push(`${url} → 200 but no access_token in body`)
        continue
      }

      const exp = decodeJwtExp(json.access_token)
      const expiresAt =
        exp ?? Math.floor(Date.now() / 1000) + (json.expires_in ?? 39600 /* 11h fallback */)

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt,
      }
    } catch (e) {
      errs.push(`${url} → ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  throw new Error(`refresh_failed: ${errs.join(' | ')}`)
}

/** Sub-second precision isn't worth it; we just need the exp claim. */
export function decodeJwtExp(jwt: string): number | null {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

/**
 * Pull a single cookie's value out of a Cookie header. Returns null if
 * absent. Quote-stripping kept simple — U-NEXT doesn't quote cookie
 * values in practice.
 */
export function readCookieValue(cookieHeader: string, name: string): string | null {
  const re = new RegExp(`(?:^|;\\s*)${escapeRe(name)}=([^;]*)`)
  const m = cookieHeader.match(re)
  return m ? m[1].trim() : null
}

/**
 * Replace one cookie's value in-place inside a Cookie header. If the
 * cookie isn't present we append it. Used to re-encode the bag after
 * a refresh writes a new `_at`.
 */
export function setCookieValue(cookieHeader: string, name: string, value: string): string {
  const re = new RegExp(`(^|;\\s*)${escapeRe(name)}=([^;]*)`, '')
  if (re.test(cookieHeader)) {
    return cookieHeader.replace(re, `$1${name}=${value}`)
  }
  return cookieHeader ? `${cookieHeader}; ${name}=${value}` : `${name}=${value}`
}

/**
 * Parse a Set-Cookie header chunk (or array of them) into a name→value
 * map. We ignore attributes (Path, HttpOnly, Max-Age, …) since we only
 * care about the value getting carried back into the next request.
 */
export function parseSetCookies(setCookieHeader: string | string[] | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!setCookieHeader) return out
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : splitSetCookieHeader(setCookieHeader)
  for (const raw of list) {
    const firstSemi = raw.indexOf(';')
    const pair = (firstSemi === -1 ? raw : raw.slice(0, firstSemi)).trim()
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name) out.set(name, value)
  }
  return out
}

/**
 * Some runtimes hand back multiple Set-Cookie values joined with commas.
 * Naive comma-split breaks on cookies whose Expires attribute contains
 * "Wed, 29 Apr 2026 …". We split on commas only when followed by a
 * `name=` token at the start of the next entry.
 */
function splitSetCookieHeader(joined: string): string[] {
  const parts: string[] = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i]
    if (ch === ',' && depth === 0) {
      const ahead = joined.slice(i + 1).trimStart()
      if (/^[A-Za-z0-9_!#$%&'*+\-.^`|~]+=/.test(ahead)) {
        parts.push(buf.trim())
        buf = ''
        continue
      }
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
