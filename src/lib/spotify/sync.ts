import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson, encryptJson } from '@/lib/crypto'
import {
  isExpiringSoon,
  refreshAccessToken,
  type SpotifyTokens,
} from './auth'
import {
  fetchRecentlyPlayed,
  fetchSavedTracks,
  type SpotifyTrack,
} from './api'

type ConnectionRow = {
  id: string
  user_id: string
  credentials_encrypted: string  // returned as base64 from Supabase REST
  status: string
}

type SyncResult = {
  added: number
  updated: number
  failed: number
}

/**
 * Sync one Spotify connection. Refreshes access token if needed, pulls
 * recently-played + saved tracks, and upserts items.
 */
export async function syncSpotifyConnection(connectionId: string): Promise<SyncResult> {
  const supabase = adminClient()

  const { data: conn, error: connErr } = await supabase
    .from('connections')
    .select('id, user_id, credentials_encrypted, status')
    .eq('id', connectionId)
    .eq('provider', 'spotify')
    .maybeSingle()

  if (connErr || !conn) {
    throw new Error(`Spotify connection ${connectionId} not found: ${connErr?.message ?? 'no row'}`)
  }

  // Supabase returns bytea as either base64 string or hex-prefixed string.
  // Use the explicit RPC if needed; here we assume the .pgrst returns it as a
  // \x-prefixed hex string when encoded as text. We'll fetch it via raw SQL
  // through a function call, but for simplicity in MVP, we re-fetch via a
  // dedicated RPC to be added later. For now, base64-decode.
  const creds = bytesFromPgrst((conn as ConnectionRow).credentials_encrypted)
  let tokens = decryptJson<SpotifyTokens>(creds)

  if (isExpiringSoon(tokens)) {
    tokens = await refreshAccessToken(tokens.refresh_token)
    await supabase
      .from('connections')
      .update({ credentials_encrypted: encryptJson(tokens) })
      .eq('id', connectionId)
  }

  const startedAt = new Date().toISOString()
  const result: SyncResult = { added: 0, updated: 0, failed: 0 }

  try {
    const [recent, saved] = await Promise.all([
      fetchRecentlyPlayed(tokens.access_token),
      fetchSavedTracks(tokens.access_token, 4),
    ])

    const rows = [
      ...recent.map((r) => trackToItemRow({
        userId: conn.user_id,
        connectionId,
        source: 'spotify_recent',
        track: r.track,
        consumedAt: r.played_at,
      })),
      ...saved.map((s) => trackToItemRow({
        userId: conn.user_id,
        connectionId,
        source: 'spotify_saved',
        track: s.track,
        consumedAt: s.added_at,
      })),
    ]

    if (rows.length > 0) {
      const { error: upsertErr, count } = await supabase
        .from('items')
        .upsert(rows, { onConflict: 'user_id,source,external_id', count: 'exact' })
      if (upsertErr) {
        result.failed = rows.length
        throw upsertErr
      }
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
      items_updated: result.updated,
      items_failed: result.failed,
    })
  } catch (err) {
    await supabase
      .from('connections')
      .update({
        error_count: 1,  // Phase 1 simplification — exponential backoff is FR-3 follow-up
        status: 'error',
      })
      .eq('id', connectionId)

    await supabase.from('sync_logs').insert({
      connection_id: connectionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'failed',
      items_added: 0,
      items_updated: 0,
      items_failed: result.failed,
      error_message: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  return result
}

function trackToItemRow(args: {
  userId: string
  connectionId: string
  source: 'spotify_recent' | 'spotify_saved'
  track: SpotifyTrack
  consumedAt: string
}) {
  const { track } = args
  const cover = track.album.images.find((i) => i.width >= 300) ?? track.album.images[0]
  return {
    user_id: args.userId,
    connection_id: args.connectionId,
    source: args.source,
    category: 'music' as const,
    external_id: track.id,
    title: track.name,
    creator: track.artists.map((a) => a.name).join(', '),
    cover_image_url: cover?.url ?? null,
    source_url: track.external_urls.spotify,
    metadata: {
      album: track.album.name,
      release_date: track.album.release_date,
      artist_ids: track.artists.map((a) => a.id),
    },
    consumed_at: args.consumedAt,
  }
}

/**
 * Supabase REST returns bytea as a `\x` hex-prefixed string. Convert to Buffer.
 */
function bytesFromPgrst(value: string | Uint8Array): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex')
    // Fallback: assume base64
    return Buffer.from(value, 'base64')
  }
  throw new Error('Unrecognized bytea encoding from pgrst')
}
