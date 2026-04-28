/**
 * Persisted credential blob for the Jump+ connection. Encrypted with
 * TOKEN_ENCRYPTION_KEY before being written to connections.credentials_encrypted.
 *
 * No password is stored — the user pastes a Cookie header value from
 * their already-authenticated browser. When the cookies expire the
 * connection turns "expired" and the user re-pastes.
 */
export type JumpplusCredentials = {
  cookies: SerializedCookie[]
  /** unix epoch (seconds) when cookies were saved. */
  cookies_at: number
}

export type SerializedCookie = {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export type JumpplusItem = {
  category: 'comic'
  external_id: string
  title: string
  creator: string | null
  cover_image_url: string | null
  source_url: string | null
  consumed_at: string | null
  metadata: Record<string, unknown>
}
