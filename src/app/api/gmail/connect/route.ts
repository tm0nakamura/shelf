import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl } from '@/lib/google/oauth'
import { env } from '@/lib/env'

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    return NextResponse.redirect(new URL('/login', env.APP_URL))
  }

  const state = randomBytes(16).toString('hex')
  const url = buildAuthorizeUrl(state)
  const res = NextResponse.redirect(url)

  res.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })
  return res
}
