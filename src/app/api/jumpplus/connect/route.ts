import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { encryptJson } from '@/lib/crypto'
import { parseCookieHeader, verifyCookies } from '@/lib/jumpplus/auth'
import type { JumpplusCredentials } from '@/lib/jumpplus/types'

export const runtime = 'nodejs'

const Body = z.object({
  cookies: z.string().min(8).max(20000),
})

/**
 * POST /api/jumpplus/connect — accepts a raw `Cookie:` header value the
 * user pasted from their browser DevTools. We parse, validate against
 * /mypage, and persist on success. No password ever touches the server.
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

  const cookies = parseCookieHeader(body.cookies)
  if (cookies.length === 0) {
    return NextResponse.json(
      { error: 'no_cookies_parsed', detail: 'Cookie ヘッダから 1 つも値が取れませんでした' },
      { status: 400 },
    )
  }

  const ok = await verifyCookies(cookies)
  if (!ok) {
    return NextResponse.json(
      { error: 'cookies_invalid', detail: '/mypage が拒否されました。Jump+ にログイン中のブラウザでコピーした Cookie か確認してください' },
      { status: 400 },
    )
  }

  const creds: JumpplusCredentials = {
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
        auth_type: 'cookie',
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
