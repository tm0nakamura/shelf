import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PRESETS: Array<{ category: string; url: string; needs_login?: boolean }> = [
  // Books / 書籍
  { category: '本（読書メーター）', url: 'https://bookmeter.com/' },
  { category: '本（ブクログ）', url: 'https://booklog.jp/' },
  { category: '本（honto）', url: 'https://honto.jp/' },
  { category: '本（hardcover）', url: 'https://hardcover.app/books/the-three-body-problem' },
  // Manga
  { category: '漫画（少年ジャンプ+）', url: 'https://shonenjumpplus.com/series/13932016480028799982' },
  { category: '漫画（コミックシーモア）', url: 'https://www.cmoa.jp/' },
  { category: '漫画（ebookjapan）', url: 'https://ebookjapan.yahoo.co.jp/' },
  { category: '漫画（BOOK☆WALKER）', url: 'https://bookwalker.jp/' },
  { category: '漫画（ピッコマ）', url: 'https://piccoma.com/web/' },
  { category: '漫画（LINEマンガ）', url: 'https://manga.line.me/' },
  // Films / TV
  { category: '映画（Filmarks）', url: 'https://filmarks.com/movies/12345' },
  { category: '映画（Letterboxd）', url: 'https://letterboxd.com/film/parasite-2019/' },
  { category: '映画（IMDb）', url: 'https://www.imdb.com/title/tt6751668/' },
  { category: '映画（U-NEXT）', url: 'https://video.unext.jp/' },
  { category: '映画（TVer）', url: 'https://tver.jp/' },
  { category: '映画（ABEMA）', url: 'https://abema.tv/' },
  { category: '映画（Netflix）', url: 'https://www.netflix.com/jp/title/81040344' },
  // Anime
  { category: 'アニメ（Annict）', url: 'https://annict.com/works/8632' },
  { category: 'アニメ（MyAnimeList）', url: 'https://myanimelist.net/anime/41467/' },
  { category: 'アニメ（dアニメ）', url: 'https://animestore.docomo.ne.jp/animestore/' },
  // Music
  { category: '音楽（Last.fm）', url: 'https://www.last.fm/music/YOASOBI' },
  { category: '音楽（Spotify Web）', url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' },
  // Video / 動画
  { category: '動画（ニコニコ）', url: 'https://www.nicovideo.jp/' },
  // Live
  { category: 'ライブ（Peatix）', url: 'https://peatix.com/' },
  { category: 'ライブ（setlist.fm）', url: 'https://www.setlist.fm/' },
  // EC
  { category: 'EC（Amazon）', url: 'https://www.amazon.co.jp/dp/4046076461' },
  { category: 'EC（楽天）', url: 'https://www.rakuten.co.jp/' },
]

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type ProbeResult = {
  url: string
  category: string
  ok: boolean
  status: number | null
  final_url: string | null
  title: string | null
  is_bot_challenge: boolean
  is_login_redirect: boolean
  server: string | null
  cf_ray: string | null
  content_length: number
  elapsed_ms: number
  error: string | null
}

async function probeOne(category: string, url: string): Promise<ProbeResult> {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text().catch(() => '')
    const head = text.slice(0, 2000)
    return {
      url,
      category,
      ok: res.ok,
      status: res.status,
      final_url: res.url,
      title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
      is_bot_challenge:
        /just a moment|cloudflare|access denied|attention required|are you a robot|captcha/i.test(head),
      is_login_redirect: /\/(?:login|signin|sso|account\/login)/i.test(res.url),
      server: res.headers.get('server'),
      cf_ray: res.headers.get('cf-ray'),
      content_length: text.length,
      elapsed_ms: Date.now() - startedAt,
      error: null,
    }
  } catch (e) {
    return {
      url,
      category,
      ok: false,
      status: null,
      final_url: null,
      title: null,
      is_bot_challenge: false,
      is_login_redirect: false,
      server: null,
      cf_ray: null,
      content_length: 0,
      elapsed_ms: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function verdict(r: ProbeResult): { label: string; cls: string } {
  if (r.error) return { label: '✗ ERROR', cls: 'bg-red-500/15 text-red-200' }
  if (r.is_bot_challenge) return { label: '🛡 bot challenge', cls: 'bg-orange-500/15 text-orange-200' }
  if (r.cf_ray && r.status === 403) return { label: '🛡 CF block', cls: 'bg-orange-500/15 text-orange-200' }
  if (!r.ok) return { label: `✗ ${r.status}`, cls: 'bg-red-500/15 text-red-200' }
  if (r.is_login_redirect) return { label: '↪ login', cls: 'bg-yellow-500/15 text-yellow-200' }
  return { label: '✓ OK', cls: 'bg-emerald-500/15 text-emerald-200' }
}

export default async function ProbePage() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) redirect('/login')

  const isAdmin =
    !!env.IMPORT_USER_ID && userRes.user.id === env.IMPORT_USER_ID
  if (!isAdmin) {
    return (
      <main className="min-h-dvh bg-[#14110f] text-white px-6 py-10">
        <div className="max-w-md mx-auto text-sm text-white/60">
          このページは <code>IMPORT_USER_ID</code> に登録された管理ユーザーのみ閲覧できます。
        </div>
      </main>
    )
  }

  const results = await Promise.all(
    PRESETS.map((p) => probeOne(p.category, p.url)),
  )

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="font-serif text-3xl font-light italic">probe results</h1>
          <p className="text-xs text-white/50">
            {results.length} sites · Vercel(AWS) → 各サイトへの直接 fetch
          </p>
        </div>
        <p className="text-sm text-white/55 leading-relaxed mb-8">
          ✓ OK = AWS IP からスクレイプ可能 · 🛡 = bot/CF ブロック · ↪ login = 認証必須(別途 Cookie が要る) · ✗ = 落ちてる
        </p>

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-white/5 text-white/50 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-3">サービス</th>
                <th className="text-left px-3 py-3">判定</th>
                <th className="text-left px-3 py-3">status</th>
                <th className="text-left px-3 py-3">title</th>
                <th className="text-right px-3 py-3">size</th>
                <th className="text-right px-3 py-3">ms</th>
                <th className="text-left px-3 py-3">server</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {results.map((r) => {
                const v = verdict(r)
                return (
                  <tr key={r.url} className="align-top">
                    <td className="px-3 py-3">
                      <div className="font-bold">{r.category}</div>
                      <div className="text-[10px] text-white/40 break-all">{r.url}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`inline-block rounded-full px-2 py-0.5 font-medium ${v.cls}`}>
                        {v.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-white/60">{r.status ?? '-'}</td>
                    <td className="px-3 py-3 text-white/70 max-w-[260px] truncate" title={r.title ?? ''}>
                      {r.title ?? (r.error ? `error: ${r.error}` : '-')}
                    </td>
                    <td className="px-3 py-3 text-right text-white/40 tabular-nums">
                      {r.content_length.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right text-white/40 tabular-nums">
                      {r.elapsed_ms}
                    </td>
                    <td className="px-3 py-3 text-white/40 text-[10px]">
                      {r.server ?? '-'}
                      {r.cf_ray && <div className="text-orange-300/70">cf-ray</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-white/40 mt-6 leading-relaxed">
          ページをリロードすると最新の結果が出ます。✓ OK が並んでいるサービスから優先してスクレイパーを実装すると効率的です。
          認証必須ページや個別作品ページの挙動を確認したい時は <code>/api/admin/probe</code> に POST を投げて任意 URL + Cookie で試せます。
        </p>
      </div>
    </main>
  )
}
