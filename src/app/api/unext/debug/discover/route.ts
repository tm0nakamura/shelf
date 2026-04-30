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

  // Stage 1 — scrape candidate URLs + auth-y constants from the JS bundles.
  const { urls, clientIds, clientSecrets } = await scrapeCandidates(stored.cookieHeader)

  // Stage 2 — try every auth style (form / JSON / Basic) × every
  // candidate client_id we found in the bundle, against every
  // candidate URL that smells like a token endpoint.
  const probable = urls.filter((u) =>
    /(?:^|\/)(token|refresh|renew)(?:\?|$|\/)/i.test(u) ||
    /\/oauth(?:2)?(?:\/|$)/i.test(u) ||
    /\/v\d+\/auth/i.test(u),
  )

  const clientIdSet = new Set<string>(['unext', ...clientIds])
  const secretSet = new Set<string>(['', ...clientSecrets])

  const results: ProbeResult[] = []
  let winner: ProbeResult | null = null
  outer: for (const url of probable) {
    const abs = url.startsWith('http')
      ? [url]
      : [`https://oauth.unext.jp${url}`, `https://video.unext.jp${url}`]
    for (const u of abs) {
      for (const cid of clientIdSet) {
        for (const secret of secretSet) {
          for (const style of ['form', 'form_basic', 'json'] as const) {
            const r = await probeOne(u, rt, cid, secret, style)
            results.push(r)
            if (r.ok) {
              winner = r
              break outer
            }
          }
        }
      }
    }
  }

  return NextResponse.json({
    candidates_total: urls.length,
    candidates_urls: urls,
    bundle_client_ids: Array.from(clientIdSet),
    bundle_client_secrets_redacted: Array.from(secretSet).map((s) =>
      s ? `${s.slice(0, 4)}…(${s.length})` : '<empty>',
    ),
    probed: results.length,
    results: results.slice(0, 60), // cap noise
    winner: winner ? { url: winner.url, style: winner.style, client_id: winner.client_id } : null,
  })
}

async function scrapeCandidates(cookieHeader: string): Promise<{
  urls: string[]
  clientIds: string[]
  clientSecrets: string[]
}> {
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

  const foundUrls = new Set<string>()
  const foundClientIds = new Set<string>()
  const foundClientSecrets = new Set<string>()
  // Cap at first 20 chunks to stay inside the 60s function ceiling.
  for (const src of scriptSrcs.slice(0, 20)) {
    try {
      const body = await fetch(src, { cache: 'no-store' }).then((r) => r.text())
      // URL extraction (same as before).
      const reUrl =
        /(?:["'`])(https?:\/\/[^"'`\s]*(?:oauth|token|refresh|renew|auth|session)[^"'`\s]*|\/[a-z0-9_/-]*(?:token|refresh|renew|session)[a-z0-9_/-]*)(?=["'`])/gi
      for (const m of body.matchAll(reUrl)) {
        const url = m[1]
        if (url.length < 6) continue
        if (/(?:googletagmanager|google-analytics|doubleclick|criteo|facebook|line\.me|yahoo|adtrack|adservice|gum\.criteo|sst-gtm)/i.test(url)) continue
        if (/\.(png|jpg|gif|svg|webp|css)(?:[?#]|$)/i.test(url)) continue
        foundUrls.add(url)
      }

      // client_id / client_secret literal strings — minified bundles
      // commonly inline these as `client_id:"unext_web"` or as keys
      // in env-style config objects. Catches both kebab and snake forms.
      const reClientId =
        /\b(?:client[_-]?id|clientId|CLIENT[_-]?ID)\s*[:=]\s*["']([a-zA-Z0-9_-]{2,64})["']/g
      for (const m of body.matchAll(reClientId)) {
        foundClientIds.add(m[1])
      }
      const reClientSecret =
        /\b(?:client[_-]?secret|clientSecret|CLIENT[_-]?SECRET)\s*[:=]\s*["']([a-zA-Z0-9_-]{8,128})["']/g
      for (const m of body.matchAll(reClientSecret)) {
        foundClientSecrets.add(m[1])
      }
    } catch {
      // skip
    }
  }
  return {
    urls: Array.from(foundUrls).sort(),
    clientIds: Array.from(foundClientIds).sort(),
    clientSecrets: Array.from(foundClientSecrets),
  }
}

type ProbeStyle = 'form' | 'form_basic' | 'json'
type ProbeResult = {
  url: string
  style: ProbeStyle
  client_id: string
  status: number
  ok: boolean
  body_preview?: string
  error?: string
}

async function probeOne(
  url: string,
  rt: string,
  clientId: string,
  clientSecret: string,
  style: ProbeStyle,
): Promise<ProbeResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    origin: 'https://video.unext.jp',
    referer: 'https://video.unext.jp/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  }
  let body: string

  if (style === 'form') {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: clientId,
    }
    if (clientSecret) params.client_secret = clientSecret
    body = new URLSearchParams(params).toString()
  } else if (style === 'form_basic') {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    headers['authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rt,
    }).toString()
  } else {
    headers['content-type'] = 'application/json'
    const payload: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: clientId,
    }
    if (clientSecret) payload.client_secret = clientSecret
    body = JSON.stringify(payload)
  }

  try {
    const r = await fetch(url, { method: 'POST', cache: 'no-store', headers, body })
    const text = await r.text().catch(() => '')
    const ok = r.ok && /access_token/.test(text)
    return {
      url,
      style,
      client_id: clientId,
      status: r.status,
      ok,
      body_preview: text.slice(0, 200),
    }
  } catch (e) {
    return {
      url,
      style,
      client_id: clientId,
      status: 0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
