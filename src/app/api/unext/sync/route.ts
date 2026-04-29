import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncUnext } from '@/lib/unext/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/unext/sync — manual trigger from the settings page. */
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
    .eq('provider', 'unext')
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'no_unext_connection' }, { status: 404 })
  }

  try {
    const result = await syncUnext(conn.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string'
          ? (e as { message: string }).message
          : JSON.stringify(e)
    console.error('[unext/sync] failed:', e)
    return NextResponse.json({ error: msg || 'sync_failed' }, { status: 500 })
  }
}
