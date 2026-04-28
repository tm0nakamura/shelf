import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { adminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'

export const maxDuration = 60

/** CORS headers for cross-origin POST from bookmarklets. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

function corsJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  })
}

const CATEGORY_VALUES = ['music', 'book', 'film', 'comic', 'live_event', 'game'] as const

const ImportItem = z.object({
  category: z.enum(CATEGORY_VALUES),
  external_id: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  creator: z.string().max(500).nullish(),
  cover_image_url: z.string().url().nullish(),
  source_url: z.string().url().nullish(),
  acquired_at: z.string().datetime().nullish(),
  consumed_at: z.string().datetime().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const Body = z.object({
  /** Source label, e.g. "scrape_jumpplus" / "scrape_filmarks". */
  source: z.string().regex(/^[a-z0-9_]+$/i).min(1).max(64),
  items: z.array(ImportItem).min(1).max(2000),
})

/**
 * POST /api/import — bulk-upsert items from a trusted local scraper.
 *
 * Auth: Bearer IMPORT_API_TOKEN (env). User ownership is pinned to the
 * IMPORT_USER_ID env var so the scraper cannot decide which shelf it
 * writes to. Single-user PoC pattern; switch to per-user tokens stored
 * in the DB if multi-user becomes a thing.
 */
export async function POST(request: NextRequest) {
  if (!env.IMPORT_API_TOKEN || !env.IMPORT_USER_ID) {
    return corsJson(
      { error: 'import_api_not_configured' },
      { status: 503 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${env.IMPORT_API_TOKEN}`) {
    return corsJson({ error: 'unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = Body.parse(await request.json())
  } catch (e) {
    return corsJson(
      { error: 'invalid_body', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  const supabase = adminClient()
  const rows = body.items.map((it) => ({
    user_id: env.IMPORT_USER_ID,
    source: body.source,
    category: it.category,
    external_id: it.external_id,
    title: it.title,
    creator: it.creator ?? null,
    cover_image_url: it.cover_image_url ?? null,
    source_url: it.source_url ?? null,
    acquired_at: it.acquired_at ?? null,
    consumed_at: it.consumed_at ?? null,
    metadata: it.metadata ?? {},
  }))

  const { error, count } = await supabase
    .from('items')
    .upsert(rows, { onConflict: 'user_id,source,external_id', count: 'exact' })

  if (error) {
    return corsJson({ error: error.message }, { status: 500 })
  }
  return corsJson({ ok: true, count: count ?? rows.length })
}
