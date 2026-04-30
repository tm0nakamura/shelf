import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncUnextPassthrough } from '@/lib/unext/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/unext/sync-passthrough — credentials live in the user's
 * browser localStorage. They get sent up with each request, used in
 * memory only, and never persisted server-side. If U-NEXT rotated any
 * tokens during the call (Set-Cookie or /api/refreshtoken), we hand
 * the rotated cookie header back so the client can update its LS
 * copy.
 *
 * Body:
 *   { cookieHeader: string, zxuid: string, zxemp: string }
 *
 * Response:
 *   { ok: true, added: N, ..., rotatedCookieHeader: string|null }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    cookieHeader?: string
    zxuid?: string
    zxemp?: string
  }
  if (!body.cookieHeader || !body.zxuid || !body.zxemp) {
    return NextResponse.json({ error: 'missing_creds_in_body' }, { status: 400 })
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
    const result = await syncUnextPassthrough(conn.id, userRes.user.id, {
      cookieHeader: body.cookieHeader,
      zxuid: body.zxuid,
      zxemp: body.zxemp,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string'
          ? (e as { message: string }).message
          : JSON.stringify(e)
    console.error('[unext/sync-passthrough] failed:', e)
    return NextResponse.json({ error: msg || 'sync_failed' }, { status: 500 })
  }
}
