import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { fetchOgp } from '@/lib/ogp/fetch'

export const maxDuration = 15

const Body = z.object({ url: z.string().min(1) })

/** POST /api/ogp — fetch a URL and return parsed metadata for the new-item form. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = Body.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  try {
    const ogp = await fetchOgp(body.url)
    return NextResponse.json(ogp)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'ogp_failed' },
      { status: 500 },
    )
  }
}
