import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase auth callback. Handles both PKCE code exchange (Magic Link / OAuth)
 * and any error redirect surfaces.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const errorDescription = url.searchParams.get('error_description')

  if (errorDescription) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorDescription)}`, url))
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url))
    }
  }

  // Look up the public.users row to get the username for redirect.
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (userRes.user) {
    const { data: profile } = await supabase
      .from('users')
      .select('username')
      .eq('id', userRes.user.id)
      .maybeSingle()
    if (profile?.username) {
      return NextResponse.redirect(new URL(`/u/${profile.username}`, url))
    }
  }

  return NextResponse.redirect(new URL('/login', url))
}
