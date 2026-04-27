import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * Supabase client bound to the current request's cookies (Server Components,
 * Route Handlers, and Server Actions). Mutations to cookies inside Server
 * Components are silently ignored — that's expected per the SSR docs.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // No-op when called from a Server Component — proxy refresh handles it.
          }
        },
      },
    },
  )
}
