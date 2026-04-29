import { NextResponse, type NextRequest } from 'next/server'
import { adminClient } from '@/lib/supabase/admin'
import { syncSteam } from '@/lib/steam/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/steam — daily cron entry point.
 *
 * Vercel auto-injects Authorization: Bearer <CRON_SECRET> on cron
 * invocations; we verify it before running so the endpoint can't be
 * triggered externally. Walks every active steam connection and runs
 * syncSteam, swallowing per-connection failures so one stale account
 * doesn't sink the rest.
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
    .eq('provider', 'steam')
    .eq('status', 'active')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results: Array<{ connection_id: string; ok: boolean; detail?: string }> = []
  for (const conn of connections ?? []) {
    try {
      const r = await syncSteam(conn.id)
      results.push({
        connection_id: conn.id,
        ok: true,
        detail: `+${r.added} (recent ${r.recently_played}, total ${r.played_total})${
          r.private_profile ? ' [private?]' : ''
        }`,
      })
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
