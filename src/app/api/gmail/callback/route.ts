import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google/oauth'
import { encryptJson } from '@/lib/crypto'
import { syncGmailConnection } from '@/lib/google/sync'

// Initial Gmail sync may scan up to 200 messages — Vercel default 10s isn't enough.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const cookieState = request.cookies.get('gmail_oauth_state')?.value

  if (error || !code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      new URL(`/settings/connections?error=${encodeURIComponent(error ?? 'invalid_state')}`, url),
    )
  }

  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.redirect(new URL('/login', url))
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens(code)
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/settings/connections?error=${encodeURIComponent(e instanceof Error ? e.message : 'exchange_failed')}`, url),
    )
  }

  const { data: existing } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'gmail')
    .maybeSingle()

  const encrypted = encryptJson(tokens)

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
        provider: 'gmail',
        auth_type: 'oauth',
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

  // First sync — but don't block redirect more than 30s
  try {
    await Promise.race([
      syncGmailConnection(connectionId),
      new Promise((_, rej) => setTimeout(() => rej(new Error('initial_sync_timeout_30s')), 30000)),
    ])
  } catch {
    // Sync log captures the error; user can re-trigger from settings.
  }

  const res = NextResponse.redirect(new URL('/settings/connections?ok=gmail', url))
  res.cookies.delete('gmail_oauth_state')
  return res
}
