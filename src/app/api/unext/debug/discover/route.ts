import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson } from '@/lib/crypto'
import { readCookieValue } from '@/lib/unext/refresh'
import type { StoredUnextCreds } from '@/lib/unext/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/unext/debug/discover — server-side scan for U-NEXT's
 * refresh endpoint. Two-stage:
 *
 *   1. Pull video.unext.jp's HTML, walk every loaded JS chunk, extract
 *      anything that looks like an auth-related URL (oauth / token /
 *      refresh / renew / session / auth).
 *   2. For each candidate ending in /token (or matching common refresh
 *      shapes), POST with the user's _rt and report which one returns
 *      200 with an access_token.
 *
 * The user clicks "リフレッシュURLを探す" on the connection card; we
 * stash the winning URL in the connection's metadata so future syncs
 * use the right path. No copy-paste required.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = adminClient()
  const { data: conn } = await admin
    .from('connections')
    .select('id, credentials_encrypted')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'unext')
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'no_unext_connection' }, { status: 404 })
  }

  const stored = decryptJson<StoredUnextCreds>(
    (conn as { credentials_encrypted: string | Uint8Array }).credentials_encrypted,
  )
  const rt = readCookieValue(stored.cookieHeader, '_rt')
  if (!rt) {
    return NextResponse.json({ error: 'rt_missing' }, { status: 400 })
  }

  // Stage 1 — scrape candidate URLs from the JS bundles.
  const candidates = await scrapeCandidates(stored.cookieHeader)

  // Stage 2 — probe each candidate that looks like a token/refresh
  // endpoint. We try form-urlencoded first (RFC 6749) then JSON.
  const probable = candidates.filter((u) =>
    /(?:^|\/)(token|refresh|renew)(?:\?|$|\/)/i.test(u) ||
    /\/oauth(?:\/|$)/i.test(u) ||
    /\/v\d+\/auth/i.test(u),
  )
  const results = await probeAll(probable, rt)
  const winner = results.find((r) => r.ok) ?? null

  return NextResponse.json({
    candidates_total: candidates.length,
    probed: probable.length,
    results,
    winner: winner?.url ?? null,
  })
}

async function scrapeCandidates(cookieHeader: string): Promise<string[]> {
  const html = await fetch('https://video.unext.jp/', {
    cache: 'no-store',
    headers: {
      cookie: cookieHeader,
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    },
  })
    .then((r) => r.text())
    .catch(() => '')

  const scriptSrcs = Array.from(html.matchAll(/<script[^>]*src=["']([^"']+)["']/g))
    .map((m) => m[1])
    .filter((src) => src.startsWith('/resources/_next/static/'))
    .map((src) => `https://video.unext.jp${src}`)

  // Also walk the buildManifest to find page-specific chunks (mylist/
  // history etc.) — those tend to carry the auth glue.
  const manifestMatch = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/)
  if (manifestMatch) {
    scriptSrcs.push(`https://video.unext.jp/resources/_next/static/${manifestMatch[1]}/_buildManifest.js`)
  }

  const found = new Set<string>()
  // Cap at first 20 chunks to stay inside the 60s function ceiling.
  for (const src of scriptSrcs.slice(0, 20)) {
    try {
      const body = await fetch(src, { cache: 'no-store' }).then((r) => r.text())
      // Match either a fully-qualified https URL or an absolute path
      // containing one of the auth keywords.
      const re =
        /(?:["'`])(https?:\/\/[^"'`\s]*(?:oauth|token|refresh|renew|auth|session)[^"'`\s]*|\/[a-z0-9_/-]*(?:token|refresh|renew|session)[a-z0-9_/-]*)(?=["'`])/gi
      for (const m of body.matchAll(re)) {
        const url = m[1]
        // Filter trash: relative path-only fragments that are too short
        // to be useful, and obvious analytics/ad domains.
        if (url.length < 6) continue
        if (/(?:googletagmanager|google-analytics|doubleclick|criteo|facebook|line\.me|yahoo|adtrack|adservice|gum\.criteo|sst-gtm)/i.test(url)) continue
        if (/\.(png|jpg|gif|svg|webp|css)(?:[?#]|$)/i.test(url)) continue
        found.add(url)
      }
    } catch {
      // skip
    }
  }
  return Array.from(found).sort()
}

type ProbeResult = {
  url: string
  status: number
  ok: boolean
  body_preview?: string
  error?: string
}

async function probeAll(urls: string[], rt: string): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  for (const url of urls) {
    // Skip relative paths — we can't probe those without a host. We try
    // promoting them onto oauth.unext.jp and video.unext.jp.
    const abs = url.startsWith('http') ? [url] : [`https://oauth.unext.jp${url}`, `https://video.unext.jp${url}`]
    for (const candidate of abs) {
      const r = await probeOne(candidate, rt)
      out.push(r)
      if (r.ok) return out // short-circuit on first hit
    }
  }
  return out
}

async function probeOne(url: string, rt: string): Promise<ProbeResult> {
  // First attempt: standard OAuth2 form-urlencoded.
  try {
    const r = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://video.unext.jp',
        referer: 'https://video.unext.jp/',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        client_id: 'unext',
      }).toString(),
    })
    const body = await r.text().catch(() => '')
    const ok = r.ok && /access_token/.test(body)
    if (ok) {
      return { url, status: r.status, ok: true, body_preview: body.slice(0, 200) }
    }
    return { url, status: r.status, ok: false, body_preview: body.slice(0, 120) }
  } catch (e) {
    return { url, status: 0, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
