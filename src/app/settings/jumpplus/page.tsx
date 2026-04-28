import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { JumpplusForm } from './jumpplus-form'

export default async function JumpplusSettingsPage() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) redirect('/login')

  const { data: existing } = await supabase
    .from('connections')
    .select('status, last_synced_at, error_count')
    .eq('user_id', userRes.user.id)
    .eq('provider', 'jumpplus')
    .maybeSingle()

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-10">
      <div className="max-w-xl mx-auto">
        <div className="flex items-baseline justify-between mb-8">
          <h1 className="font-serif text-3xl font-light italic">Jump+ 連携</h1>
          <Link
            href="/settings/connections"
            className="text-xs font-medium tracking-wide text-white/50 hover:text-white"
          >
            ← 連携にもどる
          </Link>
        </div>

        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-xs leading-relaxed mb-6">
          <p className="font-bold mb-1.5 text-yellow-200">⚠ リスク承知の機能</p>
          <ul className="list-disc list-inside space-y-1 text-white/75">
            <li>Jump+ の <strong>ログイン情報をサーバーに保管</strong>します（AES-256-GCM 暗号化、TOKEN_ENCRYPTION_KEY 必須）。漏洩したパスワードを他で使い回している場合は **必ず Jump+ 専用にして**ください。</li>
            <li>Jump+ 利用規約 13条1項(1) は「個人的利用以外」を禁止。サーバー側自動アクセスは規約上グレー。<strong>アカウント凍結のリスクを承知の上で</strong>使ってください。</li>
            <li>Vercel(AWS) の IP が bot 判定で弾かれると動きません。その場合素直に動かないので、ローカル運用 (scripts/scrape) に切替えてください。</li>
            <li>2FA / Captcha が出たログインフローはこの実装では突破できません。</li>
          </ul>
        </div>

        {existing ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 mb-6 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold">連携中</span>
              <span className="text-xs text-white/50">{existing.status}</span>
            </div>
            <p className="text-xs text-white/50 leading-relaxed">
              最終同期: {existing.last_synced_at
                ? new Date(existing.last_synced_at).toLocaleString('ja-JP')
                : '—'}　/ エラーカウント: {existing.error_count}
            </p>
          </div>
        ) : null}

        <JumpplusForm hasExisting={!!existing} />
      </div>
    </main>
  )
}
