import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptJson } from '@/lib/crypto'
import { verifyOpenIdReturn } from '@/lib/steam/openid'
import { getPlayerSummary } from '@/lib/steam/api'
import { syncSteam, type StoredSteamCreds } from '@/lib/steam/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/steam/callback — Steam OpenID return URL.
 *
 *   1. Replay all openid.* params back to Steam to verify the signature.
 *   2. Pull the SteamID from openid.claimed_id.
 *   3. Fetch the player summary so we can store a personaname for the UI.
 *   4. Encrypt + persist into connections.
 *   5. Run the first sync inline so the shelf isn't empty when we redirect.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const params = url.searchParams

  if (params.get('openid.mode') === 'cancel') {
    return NextResponse.redirect(new URL('/settings/connections?error=steam_cancelled', url))
  }

  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.redirect(new URL('/login', url))
  }

  const steamId = await verifyOpenIdReturn(params)
  if (!steamId) {
    return NextResponse.redirect(
      new URL('/settings/connections?error=steam_openid_invalid', url),
    )
  }

  // Best-effort: pull profile name. If it fails (private / API hiccup) we
  // still proceed — only the SteamID is essential.
  let personaname: string | null = null
  try {
    const profile = await getPlayerSummary(steamId)
    personaname = profile?.personaname ?? null
  } catch {
    // ignore
  }

  const creds: StoredSteamCreds = {
    steamid: steamId,
    personaname,
    connected_at: Math.floor(Date.now() / 1000),
  }
  const encrypted = encryptJson(creds)

  const { data: existing } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'steam')
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
        new URL(`/settings/connections?error=${encodeURIComponent(updErr.message)}`, url),
      )
    }
    connectionId = existing.id
  } else {
    const { data: ins, error: insErr } = await supabase
      .from('connections')
      .insert({
        user_id: userRes.user.id,
        provider: 'steam',
        auth_type: 'openid',
        credentials_encrypted: encrypted,
        status: 'active',
      })
      .select('id')
      .single()
    if (insErr || !ins) {
      return NextResponse.redirect(
        new URL(`/settings/connections?error=${encodeURIComponent(insErr?.message ?? 'insert_failed')}`, url),
      )
    }
    connectionId = ins.id
  }

  // First sync; tolerate failure so we still land on the settings page.
  try {
    await syncSteam(connectionId)
  } catch {
    // Logged in sync_logs already.
  }

  const res = NextResponse.redirect(new URL('/settings/connections?ok=steam', url))
  res.cookies.delete('steam_openid_state')
  return res
}
