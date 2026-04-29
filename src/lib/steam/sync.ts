import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson } from '@/lib/crypto'
import {
  getOwnedGames,
  getRecentlyPlayedGames,
  steamHeaderImage,
  steamStoreUrl,
  type SteamGame,
} from './api'

export type StoredSteamCreds = {
  steamid: string
  /** Display name we cached at connect time, useful for the settings card. */
  personaname?: string | null
  connected_at: number
}

type SyncResult = {
  added: number
  updated: number
  failed: number
  recently_played: number
  played_total: number
  private_profile: boolean
}

/**
 * Pull the user's Steam library and recently-played list, upsert each
 * played game as a shelf item. Owned-but-never-played titles are skipped
 * so a Steam sale haul doesn't drown the shelf.
 */
export async function syncSteam(connectionId: string): Promise<SyncResult> {
  const supabase = adminClient()

  const { data: conn, error: connErr } = await supabase
    .from('connections')
    .select('id, user_id, credentials_encrypted, status')
    .eq('id', connectionId)
    .eq('provider', 'steam')
    .maybeSingle()
  if (connErr || !conn) {
    throw new Error(`steam connection ${connectionId} not found: ${connErr?.message ?? 'no row'}`)
  }

  const stored = decryptJson<StoredSteamCreds>(
    (conn as { credentials_encrypted: string | Uint8Array }).credentials_encrypted,
  )
  const steamId = stored.steamid

  const startedAt = new Date().toISOString()
  const result: SyncResult = {
    added: 0,
    updated: 0,
    failed: 0,
    recently_played: 0,
    played_total: 0,
    private_profile: false,
  }

  try {
    const [recent, owned] = await Promise.all([
      getRecentlyPlayedGames(steamId).catch(() => [] as SteamGame[]),
      getOwnedGames(steamId).catch(() => [] as SteamGame[]),
    ])
    result.recently_played = recent.length

    // Public-profile heuristic: if both lists are empty, the profile is
    // either truly empty or set to private. GetOwnedGames returns nothing
    // for private profiles even with a valid API key.
    if (recent.length === 0 && owned.length === 0) {
      result.private_profile = true
    }

    // Merge: keep playtime / last-played from recent (more accurate),
    // fall back to owned. Skip games never played.
    const byAppid = new Map<number, SteamGame>()
    for (const g of owned) {
      if (g.playtime_forever > 0) byAppid.set(g.appid, g)
    }
    for (const g of recent) {
      byAppid.set(g.appid, { ...byAppid.get(g.appid), ...g })
    }
    result.played_total = byAppid.size

    if (byAppid.size > 0) {
      const rows = Array.from(byAppid.values()).map((g) => ({
        user_id: conn.user_id,
        connection_id: connectionId,
        source: 'steam' as const,
        category: 'game' as const,
        external_id: String(g.appid),
        title: g.name,
        creator: null,
        cover_image_url: steamHeaderImage(g.appid),
        source_url: steamStoreUrl(g.appid),
        consumed_at:
          g.rtime_last_played && g.rtime_last_played > 0
            ? new Date(g.rtime_last_played * 1000).toISOString()
            : null,
        metadata: {
          appid: g.appid,
          playtime_forever_min: g.playtime_forever,
          playtime_2weeks_min: g.playtime_2weeks ?? 0,
        },
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
      status: result.added > 0 ? 'success' : 'partial',
      items_added: result.added,
      items_updated: 0,
      items_failed: 0,
      error_message: result.private_profile ? 'profile_private_or_empty' : null,
    })
  } catch (e) {
    const errMsg = describeError(e)
    console.error('[steam/sync] failed:', e)
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
      error_message: errMsg,
    })
    throw new Error(errMsg)
  }

  return result
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>
    const parts: string[] = []
    if (typeof obj.message === 'string') parts.push(obj.message)
    if (typeof obj.code === 'string') parts.push(`code=${obj.code}`)
    if (typeof obj.details === 'string') parts.push(`details=${obj.details}`)
    if (typeof obj.hint === 'string') parts.push(`hint=${obj.hint}`)
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  return String(e)
}
