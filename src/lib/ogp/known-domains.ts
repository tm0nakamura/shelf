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
  // Category guess from URL or title heuristics. Amazon doesn't expose
  // category in OGP, so we lean on /b/?node=… or product type strings.
  const path = u.pathname.toLowerCase()
  const search = u.search.toLowerCase()

  let category: Category | undefined
  if (/\/(?:gp\/product|dp)\//.test(path)) {
    if (/(blu-ray|dvd|4k uhd|劇場版|ブルーレイ)/i.test(html)) category = 'film'
    else if (/(コミック|漫画|まんが|マンガ|vol\.?\s*\d+|第\s*\d+\s*巻)/i.test(html)) category = 'comic'
    else if (/(cd|アルバム|シングル|サウンドトラック|ost)/i.test(html.slice(0, 5000))) category = 'music'
    else if (/(switch|ps5|ps4|xbox|nintendo|playstation|ゲーム|ファミコン)/i.test(html.slice(0, 5000))) category = 'game'
    else category = 'book'
  }
  if (!category && /\bgames|video-games|videogames\b/.test(search)) category = 'game'

  // Author from a "by ..." structure if present, defensively.
  const authorMatch = html.match(/<a[^>]*class=["'][^"']*?contributorNameID[^"']*?["'][^>]*>([^<]+)<\/a>/i)

  return {
    category,
    creator: authorMatch?.[1].trim() ?? null,
  }
}

function guessFromRakutenUrl(u: URL): Category | undefined {
  const path = u.pathname.toLowerCase()
  if (/\/(book|book\.rakuten)/.test(path)) return 'book'
  return undefined
}
