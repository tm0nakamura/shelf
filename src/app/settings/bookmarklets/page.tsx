import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'
import { BookmarkletCopy } from './bookmarklet-copy'

export default async function BookmarkletsPage() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) redirect('/login')

  const isConfiguredUser =
    !!env.IMPORT_USER_ID && userRes.user.id === env.IMPORT_USER_ID
  const isConfigured = !!env.IMPORT_API_TOKEN && !!env.IMPORT_USER_ID

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-10">
      <div className="max-w-xl mx-auto">
        <div className="flex items-baseline justify-between mb-8">
          <h1 className="font-serif text-3xl font-light italic">ブックマークレット</h1>
          <Link
            href="/settings/connections"
            className="text-xs font-medium tracking-wide text-white/50 hover:text-white"
          >
            ← 連携にもどる
          </Link>
        </div>

        <p className="text-sm text-white/55 leading-relaxed mb-8">
          API のないサービス（少年ジャンプ+ など）に対し、自分のブラウザでログイン中に
          <span className="font-serif italic"> ワンクリックで取り込む </span>
          ためのブックマークです。
          リンクをブックマークバーにドラッグすれば保存できます。
        </p>

        {!isConfigured ? (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm leading-relaxed">
            <p className="font-bold mb-1 text-yellow-200">未設定</p>
            <p className="text-white/70">
              Vercel 側に <code className="text-yellow-200">IMPORT_API_TOKEN</code> と{' '}
              <code className="text-yellow-200">IMPORT_USER_ID</code> を設定して再デプロイしてください。
            </p>
          </div>
        ) : !isConfiguredUser ? (
          <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm">
            <p>このブックマークレットは <code>IMPORT_USER_ID</code> に登録された管理ユーザー専用です。</p>
          </div>
        ) : (
          <BookmarkletCopy
            appUrl={env.APP_URL}
            token={env.IMPORT_API_TOKEN!}
          />
        )}
      </div>
    </main>
  )
}
