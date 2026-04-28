/**
 * Persisted credential blob for the Jump+ connection. Encrypted with
 * TOKEN_ENCRYPTION_KEY before being written to connections.credentials_encrypted.
 *
 * Threat model the user accepted (see /settings/jumpplus): if the DB and the
 * encryption key both leak, the password is recoverable. Do not reuse passwords.
 */
export type JumpplusCredentials = {
  email: string
  password: string
  /** session cookies snapshotted from the last successful login. */
  cookies: SerializedCookie[]
  /** unix epoch (seconds) when cookies were last refreshed. */
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
