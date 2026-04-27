export type SpotifyImage = { url: string; width: number; height: number }

export type SpotifyTrack = {
  id: string
  name: string
  artists: { id: string; name: string }[]
  album: {
    id: string
    name: string
    release_date: string
    images: SpotifyImage[]
  }
  external_urls: { spotify: string }
}

export type RecentlyPlayedItem = {
  track: SpotifyTrack
  played_at: string  // ISO timestamp
}

export type SavedTrackItem = {
  added_at: string
  track: SpotifyTrack
}

async function fetchWithAuth<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Spotify API ${url} failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

/**
 * GET /me/player/recently-played?limit=50
 * Spotify only ever returns up to 50 most-recent items. No earlier history.
 */
export async function fetchRecentlyPlayed(accessToken: string): Promise<RecentlyPlayedItem[]> {
  const data = await fetchWithAuth<{ items: RecentlyPlayedItem[] }>(
    'https://api.spotify.com/v1/me/player/recently-played?limit=50',
    accessToken,
  )
  return data.items
}

/**
 * GET /me/tracks (Saved Tracks). Paginated.
 * Phase 1 fetches up to `maxPages * 50` items per sync — keep it bounded.
 */
export async function fetchSavedTracks(
  accessToken: string,
  maxPages = 4,
): Promise<SavedTrackItem[]> {
  const out: SavedTrackItem[] = []
  let url: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50'
  let page = 0
  while (url && page < maxPages) {
    const data: { items: SavedTrackItem[]; next: string | null } =
      await fetchWithAuth<{ items: SavedTrackItem[]; next: string | null }>(url, accessToken)
    out.push(...data.items)
    url = data.next
    page++
  }
  return out
}
