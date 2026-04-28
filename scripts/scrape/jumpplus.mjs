#!/usr/bin/env node
/**
 * Local-only scraper for 少年ジャンプ+ (shonenjumpplus.com).
 *
 * Walks the user's mypage and posts the visible series / chapter list
 * to shelf-jp's /api/import as `source: scrape_jumpplus`.
 *
 * First run: `npm run jumpplus:login` (or set HEADED=1) — a real browser
 * window opens, you log in, and the cookies persist into SHELF_USER_DATA_DIR.
 * Subsequent runs are silent and reuse the session.
 *
 * Use sparingly. Once a day max. ToS allows 個人的利用 only.
 */

import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pushItems } from './shelf-client.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const LOGIN_MODE = process.argv.includes('--login')
const HEADED = LOGIN_MODE || process.env.HEADED === '1'
const USER_DATA_DIR = path.resolve(__dirname, process.env.SHELF_USER_DATA_DIR || './.profile')

const PAGES_TO_SCRAPE = [
  'https://shonenjumpplus.com/mypage',
  'https://shonenjumpplus.com/mypage/favorites',
]

async function main() {
  console.log(`[jumpplus] launching ${HEADED ? 'headed' : 'headless'} chromium…`)
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: !HEADED,
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())

  if (LOGIN_MODE) {
    console.log('[jumpplus] LOGIN MODE: opening login page; finish login manually then close the browser.')
    await page.goto('https://shonenjumpplus.com/login', { waitUntil: 'domcontentloaded' })
    // Wait until the user closes the browser to allow the session cookie to be persisted.
    await ctx.waitForEvent('close', { timeout: 0 })
    return
  }

  const items = []
  for (const url of PAGES_TO_SCRAPE) {
    console.log(`[jumpplus] visiting ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    // Bail if not logged in.
    if (page.url().includes('/login')) {
      throw new Error('not logged in — run `npm run jumpplus:login` first')
    }
    await page.waitForTimeout(1500 + Math.random() * 1500)  // be a polite human

    const harvested = await page.evaluate(extractFromMypage)
    console.log(`[jumpplus]   harvested ${harvested.length} entries`)
    items.push(...harvested)
  }

  // Dedup by external_id (= series slug or chapter id).
  const dedup = new Map()
  for (const it of items) {
    if (!dedup.has(it.external_id)) dedup.set(it.external_id, it)
  }
  const finalItems = Array.from(dedup.values())

  await ctx.close()

  console.log(`[jumpplus] ready to push ${finalItems.length} unique items`)
  if (finalItems.length === 0) {
    console.log('[jumpplus] nothing to send. Selectors may need adjustment — see TODO at extractFromMypage.')
    return
  }
  await pushItems({ source: 'scrape_jumpplus', items: finalItems })
}

/**
 * Runs inside the page context. Walks the mypage DOM and returns an
 * array of import-ready item objects.
 *
 * The selectors below are best-guess starting points. Inspect the live
 * page (HEADED=1) the first time and adjust the queries — Jump+'s DOM
 * changes occasionally, this is the part that needs maintenance.
 */
function extractFromMypage() {
  /** @returns {Array<{ category: string, external_id: string, title: string, creator: string|null, cover_image_url: string|null, source_url: string|null, consumed_at: string|null, metadata?: any }>} */
  const out = []

  // TODO: adjust selector after inspecting actual /mypage DOM. The rough
  // shape Jump+ uses is a series-card grid where each card has:
  //   - a wrapping <a href="/series/<slug>">
  //   - a <img> for the cover
  //   - a series title text node
  //   - optionally an author byline
  const cards = document.querySelectorAll(
    'a[href^="/series/"], a[href^="/episode/"]',
  )

  cards.forEach((a) => {
    const href = a.getAttribute('href')
    if (!href) return
    const url = new URL(href, location.origin).toString()

    // external_id: prefer the series slug, fall back to episode id
    const seriesMatch = href.match(/\/series\/([^/?#]+)/)
    const episodeMatch = href.match(/\/episode\/([^/?#]+)/)
    const externalId = seriesMatch?.[1] || episodeMatch?.[1]
    if (!externalId) return

    const img = a.querySelector('img')
    const cover = img?.getAttribute('src') || img?.getAttribute('data-src') || null

    // Pull the most prominent text node as title; fall back to img alt.
    const titleEl = a.querySelector('h3, h4, .title, [class*="title"], [class*="Title"]')
    const title = (titleEl?.textContent || img?.getAttribute('alt') || '').trim()
    if (!title) return

    const authorEl = a.querySelector('[class*="author"], [class*="Author"]')
    const creator = authorEl ? authorEl.textContent?.trim() || null : null

    out.push({
      category: 'comic',
      external_id: externalId,
      title,
      creator,
      cover_image_url: cover,
      source_url: url,
      consumed_at: new Date().toISOString(),
      metadata: { kind: seriesMatch ? 'series' : 'episode' },
    })
  })

  return out
}

main().catch((err) => {
  console.error('[jumpplus] failed:', err)
  process.exit(1)
})
