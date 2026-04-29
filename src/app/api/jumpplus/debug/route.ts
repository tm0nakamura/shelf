import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decryptJson } from '@/lib/crypto'
import type { JumpplusCredentials } from '@/lib/jumpplus/types'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/jumpplus/debug — owner-only diagnostic that fetches /my with
 * the stored cookies and returns enough info to figure out why the
 * scraper isn't finding what it should:
 *
 *   - status / final URL (catches login redirects)
 *   - HTML size + title
 *   - "did this page contain 閲覧履歴 / 最後に読んだ?"
 *   - every <a href="/series/..."> / "/episode/..."> anchor we found,
 *     with whether it had an <img> child and a 300-char inner snippet
 *   - the first 4KB of HTML so we can eyeball Cloudflare or empty-SPA
 *     responses
 *
 * Don't keep this in production long — strips no PII but does dump a
 * chunk of an authenticated page.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: conn } = await supabase
    .from('connections')
    .select('credentials_encrypted')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'jumpplus')
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'no_connection' }, { status: 404 })
  }

  let stored: JumpplusCredentials
  try {
    stored = decryptJson<JumpplusCredentials>(
      (conn as { credentials_encrypted: string | Uint8Array }).credentials_encrypted,
    )
  } catch (e) {
    return NextResponse.json(
      { error: 'decrypt_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  const cookieHeader = stored.cookies
    .filter((c) => /shonenjumpplus\.com$/.test(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  const res = await fetch('https://shonenjumpplus.com/my', {
    headers: {
      Cookie: cookieHeader,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
    },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  const html = await res.text()

  type AnchorInfo = { href: string; has_img: boolean; inner_snippet: string }
  const allAnchors: AnchorInfo[] = []
  const anchorRe = /<a\s+[^>]*href=["'](\/(?:series|episode)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(html)) !== null) {
    allAnchors.push({
      href: m[1],
      has_img: /<img\s/i.test(m[2]),
      inner_snippet: m[2].replace(/\s+/g, ' ').slice(0, 300),
    })
  }

  // Look for any other anchor patterns Jump+ might be using.
  const otherHrefs: string[] = []
  const otherRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>[^<]*<img\s/gi
  let n: RegExpExecArray | null
  while ((n = otherRe.exec(html)) !== null) {
    if (!/^\/(?:series|episode)\//.test(n[1])) {
      otherHrefs.push(n[1])
    }
  }

  // Look for any embedded JSON data (Next.js / Nuxt / Rails SSR pattern)
  const jsonScripts: Array<{ id: string | null; preview: string }> = []
  const jsonScriptRe = /<script\s+(?:type=["']application\/json["']|type=["']application\/ld\+json["'])(?:\s+id=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/script>/gi
  let s: RegExpExecArray | null
  while ((s = jsonScriptRe.exec(html)) !== null) {
    jsonScripts.push({
      id: s[1] ?? null,
      preview: s[2].trim().slice(0, 400),
    })
  }

  // Slice around the 閲覧履歴 marker
  let aroundHistory: string | null = null
  const histIdx = html.indexOf('閲覧履歴')
  if (histIdx >= 0) {
    aroundHistory = html.slice(Math.max(0, histIdx - 200), histIdx + 1500)
  }

  let aroundLastRead: string | null = null
  const lastReadIdx = html.indexOf('最後に読んだ')
  if (lastReadIdx >= 0) {
    aroundLastRead = html.slice(Math.max(0, lastReadIdx - 200), lastReadIdx + 1500)
  }

  // Search for API endpoint references in the HTML — Jump+ has
  // data-endpoint="/jump_plus" so the JS likely calls /jump_plus/<thing>.
  const apiPaths = Array.from(
    new Set(
      [...html.matchAll(/['"`](\/jump_plus\/[^'"`\s)]+)/g)].map((m) => m[1]),
    ),
  ).slice(0, 30)

  // Also try the JSON API the page uses for personal data:
  // https://shonenjumpplus.com/my.json
  let myJsonStatus: number | null = null
  let myJsonBody: unknown = null
  let myJsonError: string | null = null
  try {
    const jr = await fetch('https://shonenjumpplus.com/my.json', {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://shonenjumpplus.com/my',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    myJsonStatus = jr.status
    const text = await jr.text()
    try {
      myJsonBody = JSON.parse(text)
    } catch {
      myJsonBody = text.slice(0, 4000)
    }
  } catch (e) {
    myJsonError = e instanceof Error ? e.message : String(e)
  }

  // Probe a barrage of likely Jump+ history-related endpoints.
  const candidates = [
    '/histories.json',
    '/reading_histories.json',
    '/recent_chapters.json',
    '/last_reading.json',
    '/my/histories.json',
    '/my/reading_histories.json',
    '/my/recent.json',
    '/my/recent_chapters.json',
    '/my/last_reading.json',
    '/my/bookshelf.json',
    '/my/episode_histories.json',
    '/me/histories.json',
    '/me/reading_histories.json',
    '/api/v1/me/histories',
    '/api/v1/me/reading_histories',
    '/api/v1/me/recent_chapters',
    '/jump_plus/histories.json',
    '/jump_plus/my/histories.json',
    '/update_notifications.json',
  ]
  const candidate_probes = await Promise.all(
    candidates.map(async (path) => {
      const url = `https://shonenjumpplus.com${path}`
      try {
        const r = await fetch(url, {
          headers: {
            Cookie: cookieHeader,
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Referer: 'https://shonenjumpplus.com/my',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        })
        const text = await r.text()
        return {
          path,
          status: r.status,
          size: text.length,
          is_json: /^[[{]/.test(text.trim()),
          snippet: text.slice(0, 250),
        }
      } catch (e) {
        return {
          path,
          status: null as number | null,
          size: 0,
          is_json: false,
          snippet: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  )

  // Find the bundle.js URL in the HTML and grep it for endpoint patterns.
  const bundleMatch = html.match(/<script[^>]*src=["']([^"']*bundle[^"']*)["']/i)
  let bundle_url: string | null = null
  let bundle_size: number | null = null
  let bundle_endpoint_strings: string[] = []
  if (bundleMatch) {
    const raw = bundleMatch[1]
    bundle_url = raw.startsWith('http')
      ? raw
      : `https://cdn-ak.shonenjumpplus.com${raw}`
    try {
      const br = await fetch(bundle_url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const text = await br.text()
      bundle_size = text.length
      const found = new Set<string>()
      for (const re of [
        /['"`]\/[a-z][a-z0-9_./-]*\.json['"`]/gi,
        /['"`]\/api\/v\d+\/[a-z0-9_./-]+['"`]/gi,
        /['"`]\/jump_plus\/[a-z0-9_./-]+['"`]/gi,
        /['"`]\/(?:my|me|histories|recent|update_notifications|episodes|series)\/[a-z0-9_./-]+['"`]/gi,
      ]) {
        const matches = text.match(re) ?? []
        for (const m of matches) {
          found.add(m.slice(1, -1)) // strip quotes
        }
      }
      bundle_endpoint_strings = Array.from(found).sort().slice(0, 80)
    } catch (e) {
      bundle_endpoint_strings = [
        `[bundle fetch failed: ${e instanceof Error ? e.message : String(e)}]`,
      ]
    }
  }

  return NextResponse.json({
    status: res.status,
    final_url: res.url,
    is_login_redirect: /\/(?:login|signin)/i.test(res.url),
    cookie_count_sent: stored.cookies.length,
    cookie_header_chars: cookieHeader.length,
    html_size: html.length,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
    has_history_marker: /閲覧履歴/i.test(html),
    has_last_read_marker: /最後に読んだ/i.test(html),
    anchors_found: allAnchors.length,
    anchors_with_img: allAnchors.filter((a) => a.has_img).length,
    my_json_logged_in:
      typeof myJsonBody === 'object' && myJsonBody !== null
        ? (myJsonBody as Record<string, unknown>).logged_in === true
        : null,
    candidate_probes: candidate_probes.filter((p) => p.status !== 404),
    candidate_probes_404_count: candidate_probes.filter((p) => p.status === 404).length,
    bundle_url,
    bundle_size,
    bundle_endpoint_strings,
    around_last_read: aroundLastRead,
    around_history: aroundHistory,
  })
}
