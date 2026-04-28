import 'server-only'
import type { JumpplusItem, SerializedCookie } from './types'

/**
 * Fetch /my with stored cookies and parse out series/episode entries.
 * Throws on auth failure (caller can then re-login). HTML-only — no
 * Playwright needed once cookies are in hand.
 */
export async function scrapeMypage(cookies: SerializedCookie[]): Promise<JumpplusItem[]> {
  const cookieHeader = cookies
    .filter((c) => /shonenjumpplus\.com$/.test(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  if (!cookieHeader) throw new Error('jumpplus_no_cookies')

  const items: JumpplusItem[] = []
  for (const url of MYPAGE_URLS) {
    const html = await fetchAuthed(url, cookieHeader)
    if (!html) continue
    items.push(...extractFromHtml(html))
  }

  // Dedup by external_id.
  const seen = new Set<string>()
  return items.filter((it) => {
    if (seen.has(it.external_id)) return false
    seen.add(it.external_id)
    return true
  })
}

// Jump+ uses /my for the user's home page. Sub-tabs (購入済み /
// レンタル中) exist behind the sidebar links but the URL pattern is
// site-specific and we don't want a single 404 to nuke the whole sync,
// so for now we hit /my only and let fetchAuthed swallow non-200s.
const MYPAGE_URLS = [
  'https://shonenjumpplus.com/my',
] as const

async function fetchAuthed(url: string, cookieHeader: string): Promise<string | null> {
  const res = await fetch(url, {
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

  // 401 / 403 / login redirect → cookies expired or bot-blocked.
  // Caller's catch handler treats these as the "expired" path.
  if (res.status === 401 || res.status === 403) {
    throw new Error(`jumpplus_fetch_${res.status}`)
  }
  const finalUrl = res.url
  if (finalUrl.includes('/login') || finalUrl.includes('/signin')) {
    throw new Error('jumpplus_session_expired')
  }
  // Other non-2xx (404, 5xx) — skip silently so a single sub-page miss
  // doesn't sink the whole sync.
  if (!res.ok) return null
  return res.text()
}

/**
 * Walk the /my HTML for <a href="/series/..."> / <a href="/episode/...">
 * cards. Crude but matches the same shape we use in the bookmarklet.
 */
function extractFromHtml(html: string): JumpplusItem[] {
  const out: JumpplusItem[] = []
  const anchorRe = /<a\s+[^>]*href=["'](\/(?:series|episode)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1]
    const inner = m[2]
    const seriesMatch = href.match(/\/series\/([^/?#]+)/)
    const episodeMatch = href.match(/\/episode\/([^/?#]+)/)
    const externalId = seriesMatch?.[1] ?? episodeMatch?.[1]
    if (!externalId) continue

    const titleFromAlt = inner.match(/<img[^>]*\balt=["']([^"']+)["']/i)?.[1]
    const titleFromTag = inner.match(/<(?:h\d|span|div)[^>]*>([^<]+)</i)?.[1]
    const title = (titleFromTag || titleFromAlt || '').trim()
    if (!title) continue

    const cover =
      inner.match(/<img[^>]*\bdata-src=["']([^"']+)["']/i)?.[1] ||
      inner.match(/<img[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ||
      null

    out.push({
      category: 'comic',
      external_id: externalId,
      title,
      creator: null,
      cover_image_url: cover,
      source_url: `https://shonenjumpplus.com${href}`,
      consumed_at: new Date().toISOString(),
      metadata: { kind: seriesMatch ? 'series' : 'episode' },
    })
  }
  return out
}
