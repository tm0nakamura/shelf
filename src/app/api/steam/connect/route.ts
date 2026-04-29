import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl } from '@/lib/steam/openid'
import { env } from '@/lib/env'

/**
 * GET /api/steam/connect — kick off the Steam OpenID flow.
 * Steam doesn't take an `openid.state` like vanilla OAuth, so we set our
 * own anti-CSRF cookie and check it in the callback.
 */
export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    return NextResponse.redirect(new URL('/login', env.APP_URL))
  }
  if (!env.STEAM_API_KEY) {
    return NextResponse.redirect(
      new URL('/settings/connections?error=steam_api_key_missing', env.APP_URL),
    )
  }

  const state = randomBytes(16).toString('hex')
  const returnTo = `${env.APP_URL.replace(/\/$/, '')}/api/steam/callback`
  const authorizeUrl = buildAuthorizeUrl(returnTo)
  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set('steam_openid_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })
  return res
}
