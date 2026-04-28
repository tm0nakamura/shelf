import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const CATEGORY_VALUES = ['music', 'book', 'film', 'comic', 'live_event', 'game'] as const
const SOURCE_VALUES = ['url', 'manual', 'image_upload', 'barcode'] as const

const Body = z.object({
  source: z.enum(SOURCE_VALUES),
  category: z.enum(CATEGORY_VALUES),
  title: z.string().min(1).max(500),
  creator: z.string().max(500).optional().nullable(),
  cover_image_url: z.string().url().optional().nullable(),
  source_url: z.string().url().optional().nullable(),
  acquired_at: z.string().datetime().optional().nullable(),
  consumed_at: z.string().datetime().optional().nullable(),
})

/**
 * POST /api/items — create a manually-added or URL-pasted shelf item.
 * Auth required. RLS enforces user_id = auth.uid().
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
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

  const { data, error } = await supabase
    .from('items')
    .insert({
      user_id: userRes.user.id,
      source: body.source,
      category: body.category,
      title: body.title,
      creator: body.creator ?? null,
      cover_image_url: body.cover_image_url ?? null,
      source_url: body.source_url ?? null,
      acquired_at: body.acquired_at ?? null,
      consumed_at: body.consumed_at ?? null,
      metadata: {},
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'insert_failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, id: data.id })
}
