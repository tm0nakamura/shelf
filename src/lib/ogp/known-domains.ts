/**
 * Domain-specific overrides on top of generic OGP parsing.
 *
 * Two responsibilities:
 *   1. Hint the category for known media domains (so the form pre-selects).
 *   2. Reach into the HTML for fields OGP doesn't expose (e.g. author).
 *
 * Keep this defensive — sites change their markup all the time. If a custom
 * extractor returns null, the generic OGP fields still apply.
 */

import type { Category } from '@/components/shelf/Shelf'

export type KnownDomainResult = {
  category?: Category
  /** Optional overrides — set only if the site exposes something better than OGP. */
  title?: string | null
  description?: string | null
  image?: string | null
  siteName?: string | null
  url?: string | null
  creator?: string | null
}

type GenericMeta = {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  type: string | null
}

export function resolveKnownDomain(url: string, html: string, _meta: GenericMeta): KnownDomainResult {
  const u = new URL(url)
  const host = u.hostname.toLowerCase().replace(/^www\./, '')

  // Books — major retailers / catalog sites
  if (host.endsWith('amazon.co.jp') || host.endsWith('amazon.com')) {
    return amazonHandler(u, html)
  }
  if (host.endsWith('books.rakuten.co.jp') || host.endsWith('rakuten.co.jp')) {
    return { category: guessFromRakutenUrl(u) }
  }
  if (host.endsWith('honto.jp') || host.endsWith('booklive.jp') || host.endsWith('ebookjapan.yahoo.co.jp')) {
    return { category: 'book' }
  }
  if (host.endsWith('cmoa.jp') || host.endsWith('shonenjumpplus.com') || host.endsWith('manga-up.com')) {
    return { category: 'comic' }
  }
  if (host.endsWith('booklog.jp') || host.endsWith('bookmeter.com') || host.endsWith('openlibrary.org')) {
    return { category: 'book' }
  }

  // Films
  if (host.endsWith('imdb.com') || host.endsWith('themoviedb.org') || host.endsWith('tmdb.org')) {
    return { category: 'film' }
  }
  if (host.endsWith('filmarks.com') || host.endsWith('letterboxd.com')) {
    return { category: 'film' }
  }
  if (host.endsWith('netflix.com') || host.endsWith('disneyplus.com') || host.endsWith('primevideo.com')) {
    return { category: 'film' }
  }
  if (host.endsWith('unext.jp') || host.endsWith('hulu.jp') || host.endsWith('abema.tv') || host.endsWith('tver.jp')) {
    return { category: 'film' }
  }
  if (host.endsWith('crunchyroll.com') || host.endsWith('animestore.docomo.ne.jp')) {
    return { category: 'film' }
  }

  // Music
  if (host.endsWith('open.spotify.com') || host.endsWith('music.apple.com') || host.endsWith('music.youtube.com')) {
    return { category: 'music' }
  }
  if (host.endsWith('soundcloud.com') || host.endsWith('bandcamp.com') || host.endsWith('last.fm')) {
    return { category: 'music' }
  }

  // Comics
  if (host.endsWith('mangaupdates.com') || host.endsWith('myanimelist.net') || host.endsWith('anilist.co')) {
    return { category: 'comic' }
  }
  if (host.endsWith('annict.com')) {
    return { category: 'film' }  // anime under films per our 6 categories
  }

  // Live events
  if (host.endsWith('pia.jp') || host.endsWith('eplus.jp') || host.endsWith('l-tike.com')) {
    return { category: 'live_event' }
  }
  if (host.endsWith('zaiko.io') || host.endsWith('livepocket.jp') || host.endsWith('peatix.com')) {
    return { category: 'live_event' }
  }
  if (host.endsWith('setlist.fm') || host.endsWith('songkick.com') || host.endsWith('bandsintown.com')) {
    return { category: 'live_event' }
  }

  // Games
  if (host.endsWith('store.steampowered.com') || host.endsWith('steamcommunity.com')) {
    return { category: 'game' }
  }
  if (host.endsWith('nintendo.co.jp') || host.endsWith('nintendo.com')) {
    return { category: 'game' }
  }
  if (host.endsWith('playstation.com') || host.endsWith('xbox.com')) {
    return { category: 'game' }
  }
  if (host.endsWith('itch.io') || host.endsWith('epicgames.com') || host.endsWith('gog.com')) {
    return { category: 'game' }
  }

  return {}
}

function amazonHandler(u: URL, html: string): KnownDomainResult {
  const path = u.pathname.toLowerCase()
  const search = u.search.toLowerCase()

  // --- Title: Amazon's bot-served HTML returns og:title = "Amazon.co.jp"
  // for almost every product, but the <title> tag still has the real
  // product title. Pull from <title> and strip the boilerplate prefix.
  const title = extractAmazonTitle(html)

  // --- Image: og:image is usually Amazon's logo. The product image lives
  // in id=landingImage with either data-old-hires or data-a-dynamic-image.
  const image = extractAmazonImage(html)

  // --- Author / creator
  const authorMatch = html.match(
    /<a[^>]*class=["'][^"']*?contributorNameID[^"']*?["'][^>]*>([^<]+)<\/a>/i,
  )
  let creator: string | null = authorMatch?.[1].trim() ?? null

  // --- Schema.org JSON-LD Product fallback (when present, most reliable)
  if (!title || !image || !creator) {
    const products = extractJsonLdProducts(html)
    for (const p of products) {
      if (!creator && p.author) creator = p.author
    }
  }

  // --- Category: heuristics over the page text
  let category: Category | undefined
  if (/\/(?:gp\/product|dp)\//.test(path)) {
    const head = html.slice(0, 8000)
    if (/(blu-?ray|dvd|4k uhd|劇場版|ブルーレイ)/i.test(head)) category = 'film'
    else if (/(コミック|漫画|まんが|マンガ|vol\.?\s*\d+|第\s*\d+\s*巻)/i.test(head)) category = 'comic'
    else if (/(\b(?:cd|album)\b|アルバム|シングル|サウンドトラック|\bost\b)/i.test(head)) category = 'music'
    else if (/(switch|ps5|ps4|xbox|nintendo|playstation|ゲーム|ファミコン)/i.test(head)) category = 'game'
    else category = 'book'
  }
  if (!category && /\b(?:games|video-games|videogames)\b/.test(search)) category = 'game'

  return {
    category,
    title,
    image,
    siteName: 'Amazon.co.jp',
    creator,
  }
}

function extractAmazonTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  let t = m[1].trim()
  t = decodeHtmlEntitiesLite(t)

  // Common forms:
  //   "Amazon.co.jp: 商品名 ePub | 著者名: 本"
  //   "Amazon.co.jp: 商品名: 著者名: 本"
  //   "Amazon | 商品名"
  // Strip leading "Amazon.co.jp:" / "Amazon |"
  t = t.replace(/^\s*Amazon\.(?:co\.jp|com)\s*[:|]\s*/i, '')
  t = t.replace(/^\s*Amazon\s*[:|]\s*/i, '')

  // Some pages put the category and author after the title with " : " separators.
  // Heuristic: pick the longest segment between " : " | " | " separators.
  const parts = t.split(/\s*[:|]\s*/).map((s) => s.trim()).filter(Boolean)
  if (parts.length > 1) {
    parts.sort((a, b) => b.length - a.length)
    return parts[0]
  }
  return t || null
}

function extractAmazonImage(html: string): string | null {
  // 1. data-old-hires on #landingImage (high resolution)
  const oldHires = html.match(
    /<img[^>]*id=["']landingImage["'][^>]*data-old-hires=["']([^"']+)["']/i,
  )?.[1]
  if (oldHires) return oldHires

  // 2. data-a-dynamic-image — JSON map of { "url": [w,h], ... }
  const dynamic = html.match(
    /<img[^>]*id=["']landingImage["'][^>]*data-a-dynamic-image=["']([^"']+)["']/i,
  )?.[1]
  if (dynamic) {
    try {
      const obj = JSON.parse(dynamic.replace(/&quot;/g, '"'))
      const urls = Object.keys(obj)
      if (urls.length > 0) return urls[0]
    } catch {
      // ignore
    }
  }

  // 3. JSON-LD Product image
  for (const product of extractJsonLdProducts(html)) {
    if (product.image) return product.image
  }
  return null
}

type LdProduct = { name?: string; image?: string; author?: string }

function extractJsonLdProducts(html: string): LdProduct[] {
  const out: LdProduct[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    visit(parsed, out)
  }
  return out
}

function visit(node: unknown, out: LdProduct[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const v of node) visit(v, out)
    return
  }
  const obj = node as Record<string, unknown>
  const t = obj['@type']
  const tArr = Array.isArray(t) ? t : [t]
  if (tArr.some((v) => typeof v === 'string' && v.toLowerCase() === 'product')) {
    out.push({
      name: typeof obj.name === 'string' ? obj.name : undefined,
      image: typeof obj.image === 'string'
        ? obj.image
        : Array.isArray(obj.image) && typeof obj.image[0] === 'string' ? obj.image[0] : undefined,
      author: extractAuthorString(obj.author),
    })
  }
  for (const v of Object.values(obj)) visit(v, out)
}

function extractAuthorString(a: unknown): string | undefined {
  if (typeof a === 'string') return a
  if (Array.isArray(a)) {
    return a.map((x) => extractAuthorString(x)).filter(Boolean).join(', ') || undefined
  }
  if (a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string') {
    return (a as { name: string }).name
  }
  return undefined
}

function decodeHtmlEntitiesLite(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function guessFromRakutenUrl(u: URL): Category | undefined {
  const path = u.pathname.toLowerCase()
  if (/\/(book|book\.rakuten)/.test(path)) return 'book'
  return undefined
}
