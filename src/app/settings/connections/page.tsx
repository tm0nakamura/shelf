import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { GmailActions } from './connection-actions'

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', userRes.user.id)
    .maybeSingle()

  const { data: connections } = await supabase
    .from('connections')
    .select('id, provider, status, last_synced_at, error_count')
    .eq('user_id', userRes.user.id)

  const gmail = connections?.find((c) => c.provider === 'gmail')

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-12">
      <div className="max-w-xl mx-auto">
        <div className="flex items-baseline justify-between mb-10">
          <h1 className="font-serif text-4xl font-light italic">連携</h1>
          {profile?.username && (
            <Link
              href={`/u/${profile.username}`}
              className="text-xs font-bold text-white/50 hover:text-white"
            >
              ← 棚にもどる
            </Link>
          )}
        </div>

        {params.ok === 'gmail' && (
          <Banner kind="ok">Gmail を連携しました。Amazon の購入履歴を取り込んでいます…</Banner>
        )}
        {params.error && (
          <Banner kind="error">エラー: {params.error}</Banner>
        )}

        <ul className="space-y-3">
          <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#ea4335] flex items-center justify-center font-black">G</div>
              <div className="flex-1">
                <div className="font-bold">Gmail（Amazon 購入履歴）</div>
                <div className="text-xs text-white/50 mt-0.5">
                  {gmail
                    ? gmail.status === 'active'
                      ? `連携中 · 最終同期 ${formatTime(gmail.last_synced_at)}`
                      : `エラー (${gmail.error_count})`
                    : 'Schema.org Order JSON-LD から本・漫画・映画・音楽・ゲームを抽出'}
                </div>
              </div>
              <GmailActions connected={!!gmail} />
            </div>
          </li>

          <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 opacity-50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#1db954] flex items-center justify-center font-black">S</div>
              <div className="flex-1">
                <div className="font-bold">Spotify</div>
                <div className="text-xs text-white/50 mt-0.5">
                  Spotify Web API は Premium アカウント必須（2024-11〜）。Premium 加入者は後日有効化予定
                </div>
              </div>
            </div>
          </li>

          <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-black">📚</div>
              <div className="flex-1">
                <div className="font-bold">ブックマークレット</div>
                <div className="text-xs text-white/50 mt-0.5">
                  少年ジャンプ+ など API のないサービスを 1 クリックで取り込む
                </div>
              </div>
              <Link
                href="/settings/bookmarklets"
                className="rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium tracking-wide text-xs px-4 py-2"
              >
                設定する
              </Link>
            </div>
          </li>

          <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 opacity-50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-black">↗</div>
              <div className="flex-1">
                <div className="font-bold">Share Sheet 受信</div>
                <div className="text-xs text-white/50 mt-0.5">アプリ配布後に有効化</div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </main>
  )
}

function Banner({ kind, children }: { kind: 'ok' | 'error'; children: React.ReactNode }) {
  const cls = kind === 'ok'
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
    : 'bg-red-500/10 border-red-500/30 text-red-200'
  return (
    <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  )
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}
