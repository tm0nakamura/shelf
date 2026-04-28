import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncSpotifyConnection } from '@/lib/spotify/sync'

export const maxDuration = 60

/**
 * POST /api/spotify/sync — manually trigger a sync for the signed-in user's
 * Spotify connection. Used by the settings page button.
 */
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
    .eq('provider', 'spotify')
    .maybeSingle()

  if (!conn) {
    return NextResponse.json({ error: 'no_spotify_connection' }, { status: 404 })
  }

  try {
    const result = await syncSpotifyConnection(conn.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'sync_failed' },
      { status: 500 },
    )
  }
}
