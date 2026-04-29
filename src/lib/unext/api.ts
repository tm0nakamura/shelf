import 'server-only'

/**
 * U-NEXT internal Apollo "cosmo" GraphQL client. Persisted-query only — we
 * send the SHA256 hash of the operation body that's already registered
 * server-side, plus any variables. The cookie set the user pasted at
 * connect time supplies auth (the `_at` JWT inside it).
 */

const NEXUS_HOST = 'https://cc.unext.jp'

/**
 * Hash of the cosmo_getHistoryAll query body, captured from production
 * web client v123.3-prod-5a76265 (2026-04). If U-NEXT rotates the
 * registered queries we'll see PersistedQueryNotFound and need to
 * re-capture from a fresh browser session.
 */
export const COSMO_GET_HISTORY_ALL_HASH =
  '4c4266a95195229f3e79e915d2f5d56bb8b70306e788a94920b2c3bcba3ea457'

export const APOLLO_CLIENT_NAME = 'cosmo'
export const APOLLO_CLIENT_VERSION = 'v123.3-prod-5a76265'

export type UnextEpisode = {
  id: string
  episodeName: string
  episodeTitleInfo: {
    id: string
    name: string
  }
  displayNo: string
  thumbnail: { standard: string }
  interruption: number
  duration: number
  completeFlag: boolean
}

export type UnextBookSakuhin = {
  sakuhinCode: string
  name: string
  book: {
    code: string
    name: string
    mediaType: { code: 'COMIC' | 'BOOK' | string }
    thumbnail: { standard: string }
    publisher?: { name: string }
    credits?: Array<{ penName: string }>
    publicStartDateTime?: string
  }
}

export type CosmoHistoryAll = {
  data?: {
    episodeHistory?: UnextEpisode[]
    bookHistory?: {
      books?: UnextBookSakuhin[]
    }
  }
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

export type UnextRequestContext = {
  cookieHeader: string
  zxuid: string
  zxemp: string
}

/**
 * cosmo_getHistoryAll wraps the response in our own envelope so the
 * sync layer can pick up Set-Cookie rotations (the U-NEXT web client
 * silently rewrites `_at` on most requests, and we want to mirror that).
 */
export type FetchHistoryAllResult = {
  json: CosmoHistoryAll
  /** Raw Set-Cookie header(s) — null when nothing was rotated. */
  setCookie: string | null
  /** HTTP status, surfaced so the caller can detect 401/403 and refresh. */
  status: number
}

export async function fetchHistoryAll(
  ctx: UnextRequestContext,
  opts?: { videoPageSize?: number; bookPageSize?: number },
): Promise<CosmoHistoryAll> {
  const wrapped = await fetchHistoryAllRaw(ctx, opts)
  if (wrapped.status === 401 || wrapped.status === 403) {
    throw new Error(`unext_unauthorized_${wrapped.status}`)
  }
  if (wrapped.json.errors?.length) {
    const code = wrapped.json.errors[0]?.extensions?.code
    if (code === 'PERSISTED_QUERY_NOT_FOUND') {
      throw new Error(
        'persisted_query_not_found: U-NEXT rotated client queries; re-capture COSMO_GET_HISTORY_ALL_HASH',
      )
    }
    throw new Error(`unext_graphql_error: ${wrapped.json.errors[0]?.message ?? 'unknown'}`)
  }
  return wrapped.json
}

export async function fetchHistoryAllRaw(
  ctx: UnextRequestContext,
  opts?: { videoPageSize?: number; bookPageSize?: number },
): Promise<FetchHistoryAllResult> {
  const variables = {
    videoPageSize: opts?.videoPageSize ?? 50,
    bookPageSize: opts?.bookPageSize ?? 50,
    bookVolumeGroupType: 'ALL',
    deviceType: '700',
    livePagination: { pageNumber: 1, pageSize: 15 },
  }
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: COSMO_GET_HISTORY_ALL_HASH },
  }

  const url = new URL('/', NEXUS_HOST)
  url.searchParams.set('zxuid', ctx.zxuid)
  url.searchParams.set('zxemp', ctx.zxemp)
  url.searchParams.set('operationName', 'cosmo_getHistoryAll')
  url.searchParams.set('variables', JSON.stringify(variables))
  url.searchParams.set('extensions', JSON.stringify(extensions))

  const r = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      accept: '*/*',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      'apollographql-client-name': APOLLO_CLIENT_NAME,
      'apollographql-client-version': APOLLO_CLIENT_VERSION,
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      origin: 'https://video.unext.jp',
      pragma: 'no-cache',
      referer: 'https://video.unext.jp/mylist/history',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      cookie: ctx.cookieHeader,
    },
  })

  // Even on 401 we still pull the body — the GraphQL envelope can be
  // useful in logs. We re-throw further up after the caller has had a
  // chance to inspect Set-Cookie.
  const setCookie = r.headers.get('set-cookie')
  if (!r.ok && r.status !== 401 && r.status !== 403) {
    const body = await r.text().catch(() => '')
    throw new Error(`unext_api_${r.status}: ${body.slice(0, 200)}`)
  }
  const json = (await r.json().catch(() => ({}))) as CosmoHistoryAll
  return { json, setCookie, status: r.status }
}

/** U-NEXT thumbnails come back as host-stripped paths (no scheme). */
export function unextThumbnailUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `https://${path}`
}

/**
 * Pull just the access token JWT from a Cookie header so we can read its
 * exp/sub for diagnostics. Returns null if missing or malformed — caller
 * decides what to do.
 */
export function readAccessTokenFromCookies(cookieHeader: string): {
  pfid: string
  exp: number
} | null {
  const match = cookieHeader.match(/(?:^|;\s*)_at=([^;]+)/)
  if (!match) return null
  const jwt = match[1]
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { sub?: string; exp?: number }
    if (!payload.sub || !payload.exp) return null
    return { pfid: payload.sub, exp: payload.exp }
  } catch {
    return null
  }
}
