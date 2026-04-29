import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson } from '@/lib/crypto'
import { fetchHistoryAll, unextThumbnailUrl, type UnextRequestContext } from './api'

export type StoredUnextCreds = {
  cookieHeader: string
  zxuid: string
  zxemp: string
  /** PFID extracted from the JWT, kept for the UI ("PM061424119"). */
  pfid?: string | null
  connected_at: number
}

type SyncResult = {
  added: number
  /** Movies (and unclassifiable long-form video). */
  episodes: number
  anime: number
  drama: number
  books: number
  comics: number
}

/**
 * Best-effort genre classification from the only fields cosmo_getHistoryAll
 * actually returns: episode duration and the displayNo string. Without a
 * second titleInfo query we can't reach the real U-NEXT genre tag, so we
 * fall back to the bucket sizes that empirically separate the three.
 *
 *   - duration ≥ 75min                 → film (theatrical / OVA movie)
 *   - has displayNo + duration ≤ 32min → anime (most TV anime is 22-30 min)
 *   - has displayNo + duration ≤ 75min → drama (live action TV is 40-60 min)
 *   - no displayNo + duration ≥ 30min  → film (variety specials, docs)
 *   - very short clips                 → anime (kids shorts skew this way)
 *
 * Edge cases this gets wrong: long-form drama recap episodes, anime
 * theatrical compilations. Acceptable for v1; the metadata still carries
 * duration/displayNo so a future titleInfo backfill can correct them.
 */
function classifyVideo(ep: { duration: number; displayNo: string }): 'film' | 'anime' | 'drama' {
  const dur = ep.duration ?? 0
  const hasEpisodeNo = !!ep.displayNo?.trim()
  if (dur >= 4500) return 'film'
  if (hasEpisodeNo) {
    if (dur <= 1920) return 'anime'
    if (dur <= 4500) return 'drama'
  }
  if (dur >= 1800) return 'film'
  return 'anime'
}

/**
 * Walk U-NEXT's cosmo_getHistoryAll and upsert each row as a shelf item.
 *
 * Caveats baked into the design:
 *   - The response carries no consumed_at, so items land with consumed_at=NULL.
 *     The shelf already orders by added_at when consumed_at is missing.
 *   - episodeHistory mixes anime/drama/film. Without another query we can't
 *     tell them apart, so everything goes to category='film'. Refining is a
 *     future step (cosmo_titleInfo per SID).
 *   - bookHistory.books returns one chapter/volume per series. We dedupe on
 *     sakuhinCode so a series only takes one shelf cell.
 */
export async function syncUnext(connectionId: string): Promise<SyncResult> {
  const supabase = adminClient()

  const { data: conn, error: connErr } = await supabase
    .from('connections')
    .select('id, user_id, credentials_encrypted, status')
    .eq('id', connectionId)
    .eq('provider', 'unext')
    .maybeSingle()
  if (connErr || !conn) {
    throw new Error(`unext connection ${connectionId} not found: ${connErr?.message ?? 'no row'}`)
  }

  const stored = decryptJson<StoredUnextCreds>(
    (conn as { credentials_encrypted: string | Uint8Array }).credentials_encrypted,
  )
  const ctx: UnextRequestContext = {
    cookieHeader: stored.cookieHeader,
    zxuid: stored.zxuid,
    zxemp: stored.zxemp,
  }

  const startedAt = new Date().toISOString()
  const result: SyncResult = {
    added: 0,
    episodes: 0,
    anime: 0,
    drama: 0,
    books: 0,
    comics: 0,
  }

  try {
    const json = await fetchHistoryAll(ctx, { videoPageSize: 50, bookPageSize: 50 })
    const episodes = json.data?.episodeHistory ?? []
    const books = json.data?.bookHistory?.books ?? []

    type VideoCategory = 'film' | 'anime' | 'drama'
    type Row = {
      user_id: string
      connection_id: string
      source: 'unext'
      category: VideoCategory | 'comic' | 'book'
      external_id: string
      title: string
      creator: string | null
      cover_image_url: string | null
      source_url: string | null
      consumed_at: null
      metadata: Record<string, unknown>
    }
    const rows: Row[] = []

    // One row per *work* (episodeTitleInfo.id), not per episode — so
    // watching all 12 episodes of an anime collapses into one shelf cell.
    // For each work, pick the longest-duration sample episode so the
    // film-vs-series classification doesn't get fooled by a recap.
    const epBySid = new Map<string, typeof episodes[number]>()
    for (const ep of episodes) {
      const sid = ep.episodeTitleInfo?.id
      if (!sid) continue
      const existing = epBySid.get(sid)
      if (!existing || (ep.duration ?? 0) > (existing.duration ?? 0)) {
        epBySid.set(sid, ep)
      }
    }
    for (const [sid, ep] of epBySid) {
      const cat = classifyVideo(ep)
      rows.push({
        user_id: conn.user_id,
        connection_id: connectionId,
        source: 'unext',
        category: cat,
        external_id: sid,
        title: ep.episodeTitleInfo.name,
        creator: null,
        cover_image_url: unextThumbnailUrl(ep.thumbnail?.standard ?? ''),
        source_url: `https://video.unext.jp/title/${sid}`,
        consumed_at: null,
        metadata: {
          last_episode_id: ep.id,
          last_episode_name: ep.episodeName,
          last_display_no: ep.displayNo,
          duration_sec: ep.duration,
          interruption_sec: ep.interruption,
          complete: ep.completeFlag,
          classified_as: cat,
        },
      })
      if (cat === 'anime') result.anime++
      else if (cat === 'drama') result.drama++
      else result.episodes++
    }

    const seenBsd = new Set<string>()
    for (const b of books) {
      const bsd = b.sakuhinCode
      if (!bsd || seenBsd.has(bsd)) continue
      seenBsd.add(bsd)
      const isComic = b.book?.mediaType?.code === 'COMIC'
      rows.push({
        user_id: conn.user_id,
        connection_id: connectionId,
        source: 'unext',
        category: isComic ? 'comic' : 'book',
        external_id: bsd,
        title: b.name,
        creator: b.book?.credits?.map((c) => c.penName).filter(Boolean).join(', ') || null,
        cover_image_url: unextThumbnailUrl(b.book?.thumbnail?.standard ?? ''),
        source_url: `https://video.unext.jp/book/title/${bsd}`,
        consumed_at: null,
        metadata: {
          media_type: b.book?.mediaType?.code,
          last_book_code: b.book?.code,
          last_book_name: b.book?.name,
          publisher: b.book?.publisher?.name,
        },
      })
      if (isComic) result.comics++
      else result.books++
    }

    if (rows.length > 0) {
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
      error_message: null,
    })
  } catch (e) {
    const errMsg = describeError(e)
    console.error('[unext/sync] failed:', e)
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
