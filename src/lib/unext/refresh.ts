import 'server-only'

/**
 * U-NEXT access-token rotation via the web client's internal refresh
 * route — discovered by scraping the JS bundle (see
 * /api/unext/debug/discover). The route is GET and reads `_rt` straight
 * off the Cookie header; on success it returns Set-Cookie with a new
 * `_at` (and rotates `_rt` half the time too). No OAuth2 grant params,
 * no client secret — the cookie jar is the entire credential.
 *
 * We pass the whole Cookie header rather than just _rt because the
 * route also looks at related session cookies (current=1, _ut, _st)
 * and refuses to refresh without them.
 */

const REFRESH_URL = 'https://video.unext.jp/api/refreshtoken'

export type RefreshResult = {
  accessToken: string
  /** U-NEXT may rotate the refresh token; if so we need to persist the new one. */
  refreshToken?: string | null
  expiresAt: number
}

export async function refreshAccessToken(cookieHeader: string): Promise<RefreshResult> {
  if (!cookieHeader) throw new Error('cookie_missing')
  if (!readCookieValue(cookieHeader, '_rt')) throw new Error('refresh_token_missing')

  const r = await fetch(REFRESH_URL, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      cookie: cookieHeader,
      origin: 'https://video.unext.jp',
      referer: 'https://video.unext.jp/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    },
  })

  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`refresh_failed_${r.status}: ${body.slice(0, 120)}`)
  }

  // The new tokens come back as Set-Cookie, not in the JSON body. We
  // pluck them out so the sync layer can splice them into the stored
  // cookie header.
  const setCookie = r.headers.get('set-cookie')
  const rotated = parseSetCookies(setCookie)
  const newAt = rotated.get('_at')
  if (!newAt) {
    throw new Error('refresh_succeeded_but_no_at_in_set_cookie')
  }
  const newRt = rotated.get('_rt') ?? null

  const exp = decodeJwtExp(newAt)
  const expiresAt = exp ?? Math.floor(Date.now() / 1000) + 39600 /* 11h fallback */

  return { accessToken: newAt, refreshToken: newRt, expiresAt }
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
