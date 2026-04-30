import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseUnextPaste } from '@/lib/unext/curl-parser'
import { readAccessTokenFromCookies } from '@/lib/unext/api'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/unext/connect-passthrough — receives the user's pasted cURL,
 * parses out the cookie blob + zxuid + zxemp, returns them to the
 * client so they can be written to localStorage. The server itself
 * never persists the credentials; we only insert / update a stub
 * connection row (credentials_encrypted = NULL) so the existing
 * settings UI can detect "this user has set up U-NEXT" and the items
 * upsert has a connection_id to point at.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { paste?: string }
  const raw = String(body.paste ?? '')
  const parsed = parseUnextPaste(raw)
  if (!parsed) {
    return NextResponse.json({ error: 'unext_paste_invalid' }, { status: 400 })
  }
  const tokenInfo = readAccessTokenFromCookies(parsed.cookieHeader)
  if (!tokenInfo) {
    return NextResponse.json({ error: 'unext_at_missing' }, { status: 400 })
  }

  // Stub-out the connection row. We use null credentials so existing
  // syncUnext (DB-mode) refuses to run on this row — the user must go
  // through sync-passthrough.
  const { data: existing } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'unext')
    .maybeSingle()

  let connectionId: string
  if (existing) {
    const { error: updErr } = await supabase
      .from('connections')
      .update({
        credentials_encrypted: null,
        status: 'active',
        error_count: 0,
      })
      .eq('id', existing.id)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
    connectionId = existing.id
  } else {
    const { data: ins, error: insErr } = await supabase
      .from('connections')
      .insert({
        user_id: userRes.user.id,
        provider: 'unext',
        auth_type: 'cookie_passthrough',
        credentials_encrypted: null,
        status: 'active',
      })
      .select('id')
      .single()
    if (insErr || !ins) {
      return NextResponse.json({ error: insErr?.message ?? 'insert_failed' }, { status: 500 })
    }
    connectionId = ins.id
  }

  return NextResponse.json({
    ok: true,
    connectionId,
    creds: {
      cookieHeader: parsed.cookieHeader,
      zxuid: parsed.zxuid,
      zxemp: parsed.zxemp,
      pfid: tokenInfo.pfid,
      connectedAt: Math.floor(Date.now() / 1000),
    },
  })
}
