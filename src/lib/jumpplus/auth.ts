import 'server-only'
import type { SerializedCookie } from './types'

/**
 * Parse a raw `Cookie:` header value (as the user copies it out of
 * their browser DevTools) into the structured cookie list we persist.
 *
 *   "name1=value1; name2=value2"  →  [ { name, value, domain, path } ]
 *
 * Domain is filled in defensively so /scrape can still target Jump+
 * even though a request-side Cookie header doesn't carry one.
 */
export function parseCookieHeader(header: string): SerializedCookie[] {
  const out: SerializedCookie[] = []
  const trimmed = header.trim().replace(/^Cookie:\s*/i, '')
  if (!trimmed) return out

  for (const raw of trimmed.split(/;\s*/)) {
    if (!raw) continue
    const eq = raw.indexOf('=')
    if (eq === -1) continue
    const name = raw.slice(0, eq).trim()
    const value = raw.slice(eq + 1).trim()
    if (!name) continue
    out.push({
      name,
      value,
      domain: '.shonenjumpplus.com',
      path: '/',
    })
  }
  return out
}

/**
 * Try to fetch /mypage with the supplied cookies. Returns true if Jump+
 * accepted the session (200 + we didn't end up on /login). Used by the
 * connect endpoint to validate a paste before persisting it, and by
 * sync to detect cookie expiry.
 */
export async function verifyCookies(cookies: SerializedCookie[]): Promise<boolean> {
  const cookieHeader = cookies
    .filter((c) => /shonenjumpplus\.com$/.test(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  if (!cookieHeader) return false

  const res = await fetch('https://shonenjumpplus.com/mypage', {
    headers: {
      Cookie: cookieHeader,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
    },
    redirect: 'follow',
    cache: 'no-store',
  })
  if (!res.ok) return false
  if (/\/(?:login|signin)/i.test(res.url)) return false
  return true
}
