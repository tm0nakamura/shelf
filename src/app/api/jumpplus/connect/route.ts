import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { encryptJson } from '@/lib/crypto'
import { loginToJumpplus } from '@/lib/jumpplus/auth'
import type { JumpplusCredentials } from '@/lib/jumpplus/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  email: z.string().email().max(256),
  password: z.string().min(1).max(256),
})

/**
 * POST /api/jumpplus/connect — verifies a Jump+ login by spinning up a
 * headless Chromium, then stores email + password + the resulting
 * cookies (all encrypted) so the daily cron can keep syncing.
 *
 * Risk surface — read /settings/jumpplus before enabling: password is
 * stored on the server even though encrypted; account ban risk per
 * Jump+ ToS; Vercel IPs may get bot-blocked at any time.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = Body.parse(await request.json())
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  let cookies
  try {
    cookies = await loginToJumpplus({ email: body.email, password: body.password })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'login_failed' },
      { status: 502 },
    )
  }

  const creds: JumpplusCredentials = {
    email: body.email,
    password: body.password,
    cookies,
    cookies_at: Math.floor(Date.now() / 1000),
  }
  const encrypted = encryptJson(creds)

  const { data: existing } = await supabase
    .from('connections')
    .select('id')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'jumpplus')
    .maybeSingle()

  let connectionId: string
  if (existing) {
    const { error: updErr } = await supabase
      .from('connections')
      .update({ credentials_encrypted: encrypted, status: 'active', error_count: 0 })
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
        provider: 'jumpplus',
        auth_type: 'password',
        credentials_encrypted: encrypted,
        status: 'active',
      })
      .select('id')
      .single()
    if (insErr || !ins) {
      return NextResponse.json({ error: insErr?.message ?? 'insert_failed' }, { status: 500 })
    }
    connectionId = ins.id
  }

  return NextResponse.json({ ok: true, connection_id: connectionId, cookies: cookies.length })
}
