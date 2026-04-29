import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function UnextConnectPage() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    redirect('/login')
  }

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-baseline justify-between mb-10">
          <h1 className="font-serif text-4xl font-light italic">U-NEXT 連携</h1>
          <Link
            href="/settings/connections"
            className="text-xs font-bold text-white/50 hover:text-white"
          >
            ← もどる
          </Link>
        </div>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-white/70">
          <p className="mb-4 text-white/90 font-bold">手順（5分）</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              PC のブラウザで{' '}
              <a
                href="https://video.unext.jp/mylist/history"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-white"
              >
                U-NEXT の視聴履歴ページ
              </a>{' '}
              を開いてログイン
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-xs">F12</kbd> で DevTools を開く →{' '}
              <b className="text-white">Network</b> タブ
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-xs">Ctrl+Shift+R</kbd> でリロード
            </li>
            <li>
              フィルタ欄に <code className="px-1.5 py-0.5 bg-white/10 rounded text-xs">cosmo_getHistoryAll</code> を入力 →
              該当行を右クリック → <b className="text-white">Copy → Copy as cURL (bash)</b>
            </li>
            <li>下のボックスに貼り付け → 「保存して同期」</li>
          </ol>
          <p className="mt-4 text-xs text-white/40">
            cURL に含まれる Cookie は AES-256-GCM で暗号化して保存します。U-NEXT のアクセストークンは数時間で期限切れになるため、エラー時は再度この手順を踏んでください。
          </p>
        </section>

        <form action="/api/unext/connect" method="POST" className="space-y-4">
          <label className="block">
            <span className="block text-xs font-bold text-white/50 mb-2">cURL をここに貼り付け</span>
            <textarea
              name="paste"
              required
              rows={10}
              placeholder={`curl 'https://cc.unext.jp/?zxuid=...&zxemp=...&operationName=cosmo_getHistoryAll&...' \\\n  -H 'apollographql-client-name: cosmo' \\\n  -b '_at=...; _rt=...; ...' \\\n  ...`}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-white text-black font-bold text-sm px-5 py-2.5 hover:bg-white/90 transition"
          >
            保存して同期
          </button>
        </form>
      </div>
    </main>
  )
}
