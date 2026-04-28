import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson } from '@/lib/crypto'
import { scrapeMypage } from './scrape'
import type { JumpplusCredentials, JumpplusItem } from './types'

type SyncResult = {
  added: number
  updated: number
  failed: number
}

/**
 * Daily Jump+ sync for one user's connection. Uses the cookies the user
 * pasted in /settings/jumpplus. When they expire, the connection moves
 * to status='expired' and the UI prompts the user to re-paste — there
 * is no server-side re-login because we don't store passwords.
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
  const stored = decryptJson<JumpplusCredentials>(creds)

  const startedAt = new Date().toISOString()
  const result: SyncResult = { added: 0, updated: 0, failed: 0 }

  let items: JumpplusItem[]
  try {
    items = await scrapeMypage(stored.cookies)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    const expired = /expired|401|403|no_cookies/i.test(reason)
    await supabase
      .from('connections')
      .update({
        error_count: 1,
        status: expired ? 'expired' : 'error',
      })
      .eq('id', connectionId)
    await supabase.from('sync_logs').insert({
      connection_id: connectionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'failed',
      items_added: 0,
      items_updated: 0,
      items_failed: 1,
      error_message: reason,
    })
    throw e
  }

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
