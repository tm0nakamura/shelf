import { NextResponse, type NextRequest } from 'next/server'
import { adminClient } from '@/lib/supabase/admin'
import { syncJumpplus } from '@/lib/jumpplus/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/jumpplus — daily cron entry point.
 *
 * Vercel auto-injects Authorization: Bearer <CRON_SECRET> on cron
 * invocations; we verify it before running so the endpoint can't be
 * triggered externally.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = adminClient()
  const { data: connections, error } = await supabase
    .from('connections')
    .select('id, user_id')
    .eq('provider', 'jumpplus')
    .eq('status', 'active')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: Array<{ connection_id: string; ok: boolean; detail?: string }> = []
  for (const conn of connections ?? []) {
    try {
      const r = await syncJumpplus(conn.id)
      results.push({ connection_id: conn.id, ok: true, detail: `+${r.added}` })
    } catch (e) {
      results.push({
        connection_id: conn.id,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, results })
}
