import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson, encryptJson } from '@/lib/crypto'
import { loginToJumpplus } from './auth'
import { scrapeMypage } from './scrape'
import type { JumpplusCredentials, JumpplusItem } from './types'

type SyncResult = {
  added: number
  updated: number
  failed: number
  refreshed_cookies: boolean
}

/**
 * Full Jump+ sync for one user's connection. Tries the stored cookies
 * first; if /mypage rejects them, re-runs the headless login with the
 * stored password, refreshes cookies, retries. Idempotent upsert.
 */
export async function syncJumpplus(connectionId: string): Promise<SyncResult> {
  const supabase = adminClient()

  const { data: conn, error: connErr } = await supabase
    .from('connections')
    .select('id, user_id, credentials_encrypted, status')
    .eq('id', connectionId)
    .eq('provider', 'jumpplus')
    .maybeSingle()
  if (connErr || !conn) {
    throw new Error(`jumpplus connection ${connectionId} not found: ${connErr?.message ?? 'no row'}`)
  }

  const creds = bytesFromPgrst(
    (conn as { credentials_encrypted: string | Uint8Array }).credentials_encrypted,
  )
  let stored = decryptJson<JumpplusCredentials>(creds)
  let refreshed = false

  const startedAt = new Date().toISOString()
  const result: SyncResult = { added: 0, updated: 0, failed: 0, refreshed_cookies: false }

  try {
    let items: JumpplusItem[]
    try {
      items = await scrapeMypage(stored.cookies)
    } catch (e) {
      // Likely cookie expired — try re-login once.
      const reason = e instanceof Error ? e.message : String(e)
      if (!/expired|401|403|no_cookies/i.test(reason)) throw e
      const fresh = await loginToJumpplus({ email: stored.email, password: stored.password })
      stored = { ...stored, cookies: fresh, cookies_at: Math.floor(Date.now() / 1000) }
      refreshed = true
      await supabase
        .from('connections')
        .update({ credentials_encrypted: encryptJson(stored) })
        .eq('id', connectionId)
      items = await scrapeMypage(stored.cookies)
    }

    result.refreshed_cookies = refreshed

    if (items.length > 0) {
      const rows = items.map((it) => ({
        user_id: conn.user_id,
        connection_id: connectionId,
        source: 'scrape_jumpplus',
        category: it.category,
        external_id: it.external_id,
        title: it.title,
        creator: it.creator,
        cover_image_url: it.cover_image_url,
        source_url: it.source_url,
        metadata: it.metadata,
        consumed_at: it.consumed_at,
      }))
      const { error: upsertErr, count } = await supabase
        .from('items')
        .upsert(rows, { onConflict: 'user_id,source,external_id', count: 'exact' })
      if (upsertErr) throw upsertErr
      result.added = count ?? rows.length
    }

    await supabase
      .from('connections')
      .update({
        last_synced_at: new Date().toISOString(),
        next_sync_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        error_count: 0,
        status: 'active',
      })
      .eq('id', connectionId)

    await supabase.from('sync_logs').insert({
      connection_id: connectionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'success',
      items_added: result.added,
      items_updated: 0,
      items_failed: 0,
    })
  } catch (e) {
    await supabase
      .from('connections')
      .update({ error_count: 1, status: 'error' })
      .eq('id', connectionId)
    await supabase.from('sync_logs').insert({
      connection_id: connectionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'failed',
      items_added: 0,
      items_updated: 0,
      items_failed: 1,
      error_message: e instanceof Error ? e.message : String(e),
    })
    throw e
  }

  return result
}

function bytesFromPgrst(value: string | Uint8Array): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex')
    return Buffer.from(value, 'base64')
  }
  throw new Error('Unrecognized bytea encoding from pgrst')
}
