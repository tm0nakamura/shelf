import 'server-only'
import type { JumpplusItem, SerializedCookie } from './types'

/**
 * Fetch /mypage with stored cookies and parse out series/episode entries.
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

// Jump+ uses /my (not /mypage) for the user's home; sub-tabs hang off it.
// 購入済み = /my/purchased, レンタル中 = /my/rental.
const MYPAGE_URLS = [
  'https://shonenjumpplus.com/my',
  'https://shonenjumpplus.com/my/purchased',
  'https://shonenjumpplus.com/my/rental',
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
  // /login redirect or 401/403 → cookies expired or bot-blocked.
  if (!res.ok) {
    throw new Error(`jumpplus_fetch_${res.status}`)
  }
  const finalUrl = res.url
  if (finalUrl.includes('/login') || finalUrl.includes('/signin')) {
    throw new Error('jumpplus_session_expired')
  }
  return res.text()
}

/**
 * Walk the mypage HTML for <a href="/series/..."> / <a href="/episode/...">
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
