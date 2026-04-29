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
    sample_anchors: allAnchors.slice(0, 8),
    other_card_hrefs_sample: Array.from(new Set(otherHrefs)).slice(0, 12),
    embedded_json_scripts: jsonScripts,
    around_last_read: aroundLastRead,
    around_history: aroundHistory,
    discovered_api_paths: apiPaths,
    html_head_4k: html.slice(0, 4000),
  })
}
