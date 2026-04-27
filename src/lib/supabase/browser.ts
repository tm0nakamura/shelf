'use client'

import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

let _client: ReturnType<typeof createBrowserClient> | null = null

export function browserClient() {
  if (!_client) {
    _client = createBrowserClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
  }
  return _client
}
