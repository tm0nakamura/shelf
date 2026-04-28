import 'server-only'
import type { SerializedCookie } from './types'

/**
 * Parse cookie pairs the user pasted out of DevTools.
 *
 * Accepts whatever shape the user copy-pasted:
 *   - Network tab Cookie header:    "name1=value1; name2=value2"
 *   - Application tab one-per-line: "name1=value1\nname2=value2"
 *   - Tab-separated tabular paste:  "name1\tvalue1\nname2\tvalue2"
 *
 * Strips a leading "Cookie:" prefix when present. Domain is filled in
 * defensively so /scrape can still target Jump+ even though a request-
 * side Cookie header doesn't carry one.
 */
export function parseCookieHeader(header: string): SerializedCookie[] {
  const out: SerializedCookie[] = []
  const seen = new Set<string>()
  const trimmed = header.trim().replace(/^Cookie:\s*/i, '')
  if (!trimmed) return out

  for (const raw of trimmed.split(/[;\n\r]+/)) {
    const piece = raw.trim()
    if (!piece) continue

    // Try `name=value`, then `name<TAB>value` (Application tab tabular paste).
    let name = ''
    let value = ''
    const eq = piece.indexOf('=')
    const tab = piece.indexOf('\t')
    if (eq > 0) {
      name = piece.slice(0, eq).trim()
      value = piece.slice(eq + 1).trim()
    } else if (tab > 0) {
      name = piece.slice(0, tab).trim()
      value = piece.slice(tab + 1).trim()
    } else {
      continue
    }
    if (!name || seen.has(name)) continue
    seen.add(name)

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
