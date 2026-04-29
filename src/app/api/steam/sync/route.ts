import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncSteam } from '@/lib/steam/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/steam/sync — manual trigger from the settings page. */
export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: conn } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'steam')
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'no_steam_connection' }, { status: 404 })
  }

  try {
    const result = await syncSteam(conn.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'sync_failed' },
      { status: 500 },
    )
  }
}
