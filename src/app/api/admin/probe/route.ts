import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const maxDuration = 30

const Body = z.object({
  url: z.string().url(),
  /** Raw `Cookie:` header value when probing logged-in pages. */
  cookies: z.string().max(20000).optional(),
  /** Override UA when impersonating a specific browser. Defaults to Chrome 124 macOS. */
  user_agent: z.string().max(500).optional(),
  /** When true, skip following redirects so we can see the bare 30x. */
  no_redirect: z.boolean().optional(),
})

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * POST /api/admin/probe — quick reachability test from Vercel's runtime
 * to any URL. Auth: Bearer IMPORT_API_TOKEN. Used to find out which JP
 * services accept AWS IPs before we invest in a real scraper for them.
 *
 * Response surfaces enough to decide:
 *   status, finalUrl (after redirects), contentType, length, snippet,
 *   bot-challenge / login-redirect heuristics, and select response headers.
 */
export async function POST(request: NextRequest) {
  if (!env.IMPORT_API_TOKEN) {
    return NextResponse.json({ error: 'probe_not_configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${env.IMPORT_API_TOKEN}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = Body.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  let res: Response
  try {
    res = await fetch(body.url, {
      headers: {
        'User-Agent': body.user_agent ?? DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        ...(body.cookies ? { Cookie: body.cookies } : {}),
      },
      redirect: body.no_redirect ? 'manual' : 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: 'fetch_threw',
      detail: e instanceof Error ? e.message : String(e),
      elapsed_ms: Date.now() - startedAt,
    })
  }

  const text = await res.text().catch(() => '')
  const head = text.slice(0, 2000)

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    final_url: res.url,
    elapsed_ms: Date.now() - startedAt,
    content_type: res.headers.get('content-type'),
    content_length: text.length,
    snippet: text.slice(0, 800),
    title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
    set_cookie_count: (res.headers.getSetCookie?.() ?? []).length,
    is_bot_challenge:
      /just a moment|cloudflare|access denied|attention required|are you a robot|captcha/i.test(head),
    is_login_redirect: /\/(?:login|signin|sso|account\/login)/i.test(res.url),
    is_html: /text\/html/i.test(res.headers.get('content-type') ?? ''),
    server: res.headers.get('server'),
    cf_ray: res.headers.get('cf-ray'),
    x_powered_by: res.headers.get('x-powered-by'),
  })
}
