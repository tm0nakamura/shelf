import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson, encryptJson } from '@/lib/crypto'
import { fetchHistoryAllRaw, unextThumbnailUrl, type UnextRequestContext } from './api'
import {
  decodeJwtExp,
  parseSetCookies,
  readCookieValue,
  refreshAccessToken,
  setCookieValue,
} from './refresh'

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
 * Two flavors:
 *   - syncUnext(id) — credentials live in connections.credentials_encrypted,
 *     server reads + decrypts + persists rotations.
 *   - syncUnextPassthrough(id, creds) — credentials live in the user's
 *     localStorage, get sent up with each request; server uses them in
 *     memory only and returns any rotation so the client can update LS.
 *
 * Caveats baked into the design:
 *   - The response carries no consumed_at, so items land with consumed_at=NULL.
 *     The shelf already orders by added_at when consumed_at is missing.
 *   - episodeHistory mixes anime/drama/film. We classify via duration +
 *     displayNo heuristic in classifyVideo().
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

  const enc = (conn as { credentials_encrypted: string | Uint8Array | null }).credentials_encrypted
  if (!enc) {
    throw new Error('unext_credentials_in_localstorage_not_db: use sync-passthrough')
  }
  const stored = decryptJson<StoredUnextCreds>(enc)

  const { result } = await runUnextSync({
    connectionId,
    userId: conn.user_id,
    cookieHeader: stored.cookieHeader,
    zxuid: stored.zxuid,
    zxemp: stored.zxemp,
    persistRotation: (rotated) => {
      const next: StoredUnextCreds = { ...stored, cookieHeader: rotated }
      return encryptJson(next)
    },
  })
  return result
}

/**
 * Pass-through variant: caller supplies the cookie header from the user's
 * browser localStorage; server never persists it. If U-NEXT rotates the
 * tokens during the call, the rotated header gets returned so the client
 * can update its local copy.
 */
export async function syncUnextPassthrough(
  connectionId: string,
  userId: string,
  inputCreds: { cookieHeader: string; zxuid: string; zxemp: string },
): Promise<SyncResult & { rotatedCookieHeader: string | null }> {
  const { result, rotatedCookieHeader } = await runUnextSync({
    connectionId,
    userId,
    cookieHeader: inputCreds.cookieHeader,
    zxuid: inputCreds.zxuid,
    zxemp: inputCreds.zxemp,
    // No DB write for credentials in passthrough mode.
    persistRotation: null,
  })
  return { ...result, rotatedCookieHeader }
}

type RunSyncArgs = {
  connectionId: string
  userId: string
  cookieHeader: string
  zxuid: string
  zxemp: string
  /** When non-null, rotated credentials get encrypted and written to
   *  connections.credentials_encrypted at the end of a successful sync. */
  persistRotation: ((rotated: string) => string) | null
}

async function runUnextSync(args: RunSyncArgs): Promise<{
  result: SyncResult
  rotatedCookieHeader: string | null
}> {
  const supabase = adminClient()
  const { connectionId, userId } = args

  // Token-management state — local to this run. Mutated by Set-Cookie
  // capture and the proactive/reactive refresh paths.
  let cookieHeader = args.cookieHeader
  let cookieDirty = false

  // Proactive refresh — if `_at` expires within 5 minutes, do the
  // /api/refreshtoken dance now so the GraphQL call doesn't get a
  // mid-request expiry.
  try {
    const refreshed = await maybeProactiveRefresh(cookieHeader)
    if (refreshed !== cookieHeader) {
      cookieHeader = refreshed
      cookieDirty = true
    }
  } catch (e) {
    // Soft-fail: if refresh blew up, fall through to the GraphQL call
    // with the (possibly expired) token. The reactive path below has
    // its own retry, and an inert refresh on a still-valid token is fine.
    console.warn('[unext/sync] proactive refresh failed, continuing:', e)
  }

  const ctx: UnextRequestContext = {
    cookieHeader,
    zxuid: args.zxuid,
    zxemp: args.zxemp,
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
    let raw = await fetchHistoryAllRaw(ctx, { videoPageSize: 50, bookPageSize: 50 })

    // Pick up any Set-Cookie rotation U-NEXT silently emits on success.
    if (raw.setCookie) {
      const rotated = applySetCookies(ctx.cookieHeader, raw.setCookie)
      if (rotated !== ctx.cookieHeader) {
        ctx.cookieHeader = rotated
        cookieDirty = true
      }
    }

    // Reactive refresh — U-NEXT signals expiry two ways:
    //   - HTTP 401/403 (rare; happens on some auth-required endpoints)
    //   - HTTP 200 with errors[0].message = "Token expired" (cosmo's
    //     usual shape — the GraphQL envelope absorbs the failure)
    // Both routes need the same recovery: refresh the access token and
    // retry once. A second failure means the refresh token itself is
    // dead and we have to surface a re-paste prompt.
    if (raw.status === 401 || raw.status === 403 || isExpiredEnvelope(raw.json)) {
      const newAt = await tryReactiveRefresh(ctx.cookieHeader)
      if (!newAt) {
        throw new Error('unext_token_expired_refresh_failed')
      }
      ctx.cookieHeader = setCookieValue(ctx.cookieHeader, '_at', newAt.accessToken)
      if (newAt.refreshToken) {
        ctx.cookieHeader = setCookieValue(ctx.cookieHeader, '_rt', newAt.refreshToken)
      }
      cookieDirty = true

      raw = await fetchHistoryAllRaw(ctx, { videoPageSize: 50, bookPageSize: 50 })
      if (raw.status === 401 || raw.status === 403 || isExpiredEnvelope(raw.json)) {
        throw new Error('unext_token_expired_post_refresh')
      }
    }

    if (raw.json.errors?.length) {
      const code = raw.json.errors[0]?.extensions?.code
      if (code === 'PERSISTED_QUERY_NOT_FOUND') {
        throw new Error(
          'persisted_query_not_found: U-NEXT rotated client queries; re-capture COSMO_GET_HISTORY_ALL_HASH',
        )
      }
      throw new Error(`unext_graphql_error: ${raw.json.errors[0]?.message ?? 'unknown'}`)
    }

    const episodes = raw.json.data?.episodeHistory ?? []
    const books = raw.json.data?.bookHistory?.books ?? []

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
        user_id: userId,
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
        user_id: userId,
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

    const update: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
      next_sync_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      error_count: 0,
      status: 'active',
    }
    // Only the DB-storage flavor writes rotated credentials back; the
    // pass-through flavor returns them to the client and never persists.
    if (cookieDirty && args.persistRotation) {
      update.credentials_encrypted = args.persistRotation(ctx.cookieHeader)
    }
    await supabase.from('connections').update(update).eq('id', connectionId)

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

    return {
      result,
      rotatedCookieHeader: cookieDirty ? ctx.cookieHeader : null,
    }
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
}

/**
 * If the access token expires within REFRESH_LEAD_SECONDS, swap it out
 * before the GraphQL call. Returns the (possibly updated) cookie header;
 * the caller merges it into `creds` and marks `credsDirty`.
 */
const REFRESH_LEAD_SECONDS = 5 * 60
async function maybeProactiveRefresh(cookieHeader: string): Promise<string> {
  const at = readCookieValue(cookieHeader, '_at')
  const rt = readCookieValue(cookieHeader, '_rt')
  if (!at || !rt) return cookieHeader

  const exp = decodeJwtExp(at)
  if (!exp) return cookieHeader
  const remaining = exp - Math.floor(Date.now() / 1000)
  if (remaining > REFRESH_LEAD_SECONDS) return cookieHeader

  const refreshed = await refreshAccessToken(cookieHeader)
  let next = setCookieValue(cookieHeader, '_at', refreshed.accessToken)
  if (refreshed.refreshToken) {
    next = setCookieValue(next, '_rt', refreshed.refreshToken)
  }
  return next
}

/** Best-effort refresh after the gateway rejects us — swallow non-throws. */
async function tryReactiveRefresh(
  cookieHeader: string,
): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  if (!readCookieValue(cookieHeader, '_rt')) return null
  try {
    const r = await refreshAccessToken(cookieHeader)
    return { accessToken: r.accessToken, refreshToken: r.refreshToken ?? null }
  } catch (e) {
    console.warn('[unext/sync] reactive refresh failed:', e)
    return null
  }
}

/**
 * Detect "your access token is dead" inside a 200-OK GraphQL response.
 * U-NEXT's cosmo gateway swallows the underlying 401 and surfaces it as
 * an envelope error like { errors: [{ message: "Token expired", ... }] }.
 * We match a small allowlist of message substrings rather than a strict
 * `extensions.code` because the gateway is inconsistent about populating
 * extensions.
 */
function isExpiredEnvelope(json: { errors?: Array<{ message?: string; extensions?: Record<string, unknown> }> }): boolean {
  if (!json.errors?.length) return false
  for (const err of json.errors) {
    const msg = (err.message ?? '').toLowerCase()
    const code = String(err.extensions?.code ?? '').toLowerCase()
    if (
      msg.includes('token expired') ||
      msg.includes('token_expired') ||
      msg.includes('unauthorized') ||
      msg.includes('unauthenticated') ||
      code === 'unauthenticated' ||
      code === 'token_expired' ||
      code === 'token_invalid'
    ) {
      return true
    }
  }
  return false
}

/** Take a Set-Cookie string from a response and merge into our Cookie header. */
function applySetCookies(cookieHeader: string, setCookieHeader: string): string {
  const rotated = parseSetCookies(setCookieHeader)
  let out = cookieHeader
  for (const [name, value] of rotated) {
    if (name === '_at' || name === '_rt' || name === 'current') {
      out = setCookieValue(out, name, value)
    }
  }
  return out
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
