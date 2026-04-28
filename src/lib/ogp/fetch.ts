/**
 * Fetch a URL and parse Open Graph + Twitter Card meta tags. Falls back
 * to <title> and <meta name="description"> when no OGP is present.
 *
 * Phase 1 keeps this simple: regex over raw HTML. We only need a handful
 * of meta fields and we don't want to pull in cheerio for a few patterns.
 */

import { resolveKnownDomain } from './known-domains'
import type { Category } from '@/components/shelf/Shelf'

export type OgpResult = {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  type: string | null
  /** Optional category guess from known-domain heuristics. */
  category?: Category
  /** Original creator/author/artist string when extractable. */
  creator: string | null
}

// Real-browser UA. A "compatible; bot/0.1" UA gets rejected by most major
// retailers (Amazon, Rakuten, etc.) before they serve any markup.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function fetchOgp(input: string): Promise<OgpResult> {
  const url = normalizeUrl(input)
  if (!url) throw new Error('invalid_url')

  // Some hosts (notably Amazon) attach huge tracking query strings that
  // can trigger 404 / region-redirect logic. Try the canonical form first,
  // fall back to the original if that comes back empty.
  const candidates = canonicalizeForFetch(url)

  let html: string | null = null
  let lastStatus = 0
  let fetchedUrl = url
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        redirect: 'follow',
        cache: 'no-store',
      })
      lastStatus = res.status
      if (res.ok) {
        const text = await res.text()
        if (text.length > 200) {
          html = text
          fetchedUrl = candidate
          break
        }
      }
    } catch {
      // Try next candidate.
    }
  }

  if (!html) {
    throw new Error(`fetch_failed_${lastStatus || 'network'}`)
  }

  const meta = {
    title: pickMeta(html, ['og:title', 'twitter:title']) ?? pickTitleTag(html),
    description: pickMeta(html, ['og:description', 'twitter:description', 'description']),
    image: pickMeta(html, ['og:image', 'twitter:image', 'twitter:image:src']),
    siteName: pickMeta(html, ['og:site_name', 'application-name']),
    type: pickMeta(html, ['og:type']),
  }

  const known = resolveKnownDomain(fetchedUrl, html, meta)

  return {
    url: known.url ?? fetchedUrl,
    title: known.title ?? meta.title,
    description: known.description ?? meta.description,
    image: known.image ?? meta.image,
    siteName: known.siteName ?? meta.siteName,
    type: meta.type,
    category: known.category,
    creator: known.creator ?? null,
  }
}

/**
 * Build a list of fetch candidates for a URL, ordered by preference.
 * For Amazon especially, the long URLs with `?keywords=...&qid=...` query
 * params can trigger their bot-mitigation flow more aggressively than the
 * canonical /dp/[ASIN] path.
 */
function canonicalizeForFetch(url: string): string[] {
  const out: string[] = []
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')

    if (host.endsWith('amazon.co.jp') || host.endsWith('amazon.com')) {
      const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1]
      if (asin) {
        out.push(`${u.origin}/dp/${asin}`)
      }
    }
  } catch {
    // fall through
  }
  // Always also try the original URL (without modification) as a fallback.
  if (!out.includes(url)) out.push(url)
  return out
}

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return u.toString()
  } catch {
    return null
  }
}

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    // Match either property="..." or name="..." with content="..."
    // Handles attribute order variation and either single/double quotes.
    const patterns = [
      new RegExp(
        `<meta[^>]*?(?:property|name)=["']${escapeRegex(name)}["'][^>]*?content=["']([^"']*)["'][^>]*?>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${escapeRegex(name)}["'][^>]*?>`,
        'i',
      ),
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m && m[1]) return decodeHtmlEntities(m[1].trim())
    }
  }
  return null
}

function pickTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  return decodeHtmlEntities(m[1].trim())
}

function decodeHtmlEntities(s: string): string {
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
