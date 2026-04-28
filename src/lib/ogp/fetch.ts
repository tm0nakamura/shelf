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

const UA = 'Mozilla/5.0 (compatible; shelf-jp/0.1; +https://shelf-wine.vercel.app)'

export async function fetchOgp(input: string): Promise<OgpResult> {
  const url = normalizeUrl(input)
  if (!url) throw new Error('invalid_url')

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
    redirect: 'follow',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`)

  const html = await res.text()

  const meta = {
    title: pickMeta(html, ['og:title', 'twitter:title']) ?? pickTitleTag(html),
    description: pickMeta(html, ['og:description', 'twitter:description', 'description']),
    image: pickMeta(html, ['og:image', 'twitter:image', 'twitter:image:src']),
    siteName: pickMeta(html, ['og:site_name', 'application-name']),
    type: pickMeta(html, ['og:type']),
  }

  const known = resolveKnownDomain(url, html, meta)

  return {
    url: known.url ?? url,
    title: known.title ?? meta.title,
    description: known.description ?? meta.description,
    image: known.image ?? meta.image,
    siteName: known.siteName ?? meta.siteName,
    type: meta.type,
    category: known.category,
    creator: known.creator ?? null,
  }
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
