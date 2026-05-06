import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ConnectForm } from './connect-form'

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
            <b className="text-white/60">プライバシーモード（v2）</b>：U-NEXT の Cookie はあなたのブラウザの localStorage にのみ保存されます。タナログのサーバーは同期する瞬間だけ受け取って通過させ、永続化しません。別の端末・別のブラウザでは再度この手順が必要です。
          </p>
        </section>

        <ConnectForm />
      </div>
    </main>
  )
}
