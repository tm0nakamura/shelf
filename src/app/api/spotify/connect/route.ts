import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl } from '@/lib/spotify/auth'

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    return NextResponse.redirect(new URL('/login', process.env.APP_URL ?? 'http://127.0.0.1:3000'))
  }

  const state = randomBytes(16).toString('hex')
  const url = buildAuthorizeUrl(state)
  const res = NextResponse.redirect(url)

  // Persist state in a short-lived HttpOnly cookie for CSRF check.
  res.cookies.set('spotify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })
  return res
}
