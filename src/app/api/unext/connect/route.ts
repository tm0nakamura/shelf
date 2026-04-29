import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptJson } from '@/lib/crypto'
import { parseUnextPaste } from '@/lib/unext/curl-parser'
import { readAccessTokenFromCookies } from '@/lib/unext/api'
import { syncUnext, type StoredUnextCreds } from '@/lib/unext/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/unext/connect — receives the user's pasted cURL/cookie blob,
 * extracts the auth bundle, encrypts and persists it, and runs the first
 * sync. The form lives at /settings/unext/connect.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const formData = await request.formData()
  const raw = String(formData.get('paste') ?? '')

  const parsed = parseUnextPaste(raw)
  if (!parsed) {
    return NextResponse.redirect(
      new URL(
        '/settings/connections?error=' + encodeURIComponent('unext_paste_invalid'),
        request.url,
      ),
    )
  }

  const tokenInfo = readAccessTokenFromCookies(parsed.cookieHeader)
  if (!tokenInfo) {
    return NextResponse.redirect(
      new URL(
        '/settings/connections?error=' + encodeURIComponent('unext_at_missing'),
        request.url,
      ),
    )
  }

  const creds: StoredUnextCreds = {
    cookieHeader: parsed.cookieHeader,
    zxuid: parsed.zxuid,
    zxemp: parsed.zxemp,
    pfid: tokenInfo.pfid,
    connected_at: Math.floor(Date.now() / 1000),
  }
  const encrypted = encryptJson(creds)

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
        credentials_encrypted: encrypted,
        status: 'active',
        error_count: 0,
      })
      .eq('id', existing.id)
    if (updErr) {
      return NextResponse.redirect(
        new URL(
          `/settings/connections?error=${encodeURIComponent(updErr.message)}`,
          request.url,
        ),
      )
    }
    connectionId = existing.id
  } else {
    const { data: ins, error: insErr } = await supabase
      .from('connections')
      .insert({
        user_id: userRes.user.id,
        provider: 'unext',
        auth_type: 'cookie',
        credentials_encrypted: encrypted,
        status: 'active',
      })
      .select('id')
      .single()
    if (insErr || !ins) {
      return NextResponse.redirect(
        new URL(
          `/settings/connections?error=${encodeURIComponent(insErr?.message ?? 'insert_failed')}`,
          request.url,
        ),
      )
    }
    connectionId = ins.id
  }

  // Initial sync — tolerate failure so the connection still lands and
  // the user can retry from the settings page.
  try {
    await syncUnext(connectionId)
  } catch {
    // sync_logs already has the cause
  }

  return NextResponse.redirect(new URL('/settings/connections?ok=unext', request.url))
}
