import 'server-only'
import { env } from '@/lib/env'

const BASE = 'https://api.steampowered.com'

export type SteamGame = {
  appid: number
  name: string
  /** Total minutes played across all platforms. */
  playtime_forever: number
  playtime_2weeks?: number
  /** Unix epoch (seconds) of last play. Only present when the user has
   *  actually played the game. */
  rtime_last_played?: number
  img_icon_url?: string
}

export type SteamProfile = {
  steamid: string
  personaname: string
  avatar?: string
  avatarfull?: string
  profileurl?: string
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!env.STEAM_API_KEY) throw new Error('STEAM_API_KEY is not configured')
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('key', env.STEAM_API_KEY)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const r = await fetch(url.toString(), { cache: 'no-store' })
  if (!r.ok) {
    throw new Error(`steam_api_${r.status}: ${path}`)
  }
  return r.json() as Promise<T>
}

/**
 * Owned games + appinfo (name, icon hash). Returns an empty array if the
 * profile is private — that's the signal for the caller to nudge the
 * user toward "Game details: Public" in their privacy settings.
 */
export async function getOwnedGames(steamId: string): Promise<SteamGame[]> {
  const json = await call<{ response?: { games?: SteamGame[] } }>(
    '/IPlayerService/GetOwnedGames/v1/',
    {
      steamid: steamId,
      include_appinfo: '1',
      include_played_free_games: '1',
    },
  )
  return json.response?.games ?? []
}

export async function getRecentlyPlayedGames(steamId: string): Promise<SteamGame[]> {
  const json = await call<{ response?: { games?: SteamGame[] } }>(
    '/IPlayerService/GetRecentlyPlayedGames/v1/',
    { steamid: steamId },
  )
  return json.response?.games ?? []
}

export async function getPlayerSummary(steamId: string): Promise<SteamProfile | null> {
  const json = await call<{ response?: { players?: SteamProfile[] } }>(
    '/ISteamUser/GetPlayerSummaries/v2/',
    { steamids: steamId },
  )
  return json.response?.players?.[0] ?? null
}

/** Steam's standard 460×215 store header. Cloudflare-fronted CDN. */
export function steamHeaderImage(appid: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`
}

/** Tall library capsule (600×900) — better for shelf cards but only set
 *  on a subset of titles. Falls back to header when callers detect 404. */
export function steamLibraryCapsule(appid: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`
}

export function steamStoreUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}/`
}
