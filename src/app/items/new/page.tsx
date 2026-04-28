import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewItemForm } from './new-item-form'

export default async function NewItemPage() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', userRes.user.id)
    .maybeSingle()

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-10">
      <div className="max-w-md mx-auto">
        <div className="flex items-baseline justify-between mb-8">
          <h1 className="font-serif text-3xl font-light italic">アイテムを追加</h1>
          {profile?.username && (
            <Link
              href={`/u/${profile.username}`}
              className="text-xs font-bold text-white/50 hover:text-white"
            >
              ← 棚にもどる
            </Link>
          )}
        </div>

        <p className="text-sm text-white/60 mb-6 leading-relaxed">
          URL を貼ると タイトル / 画像 / カテゴリ を自動取得します。手動入力にも切り替え可能。
        </p>

        <NewItemForm redirectTo={profile?.username ? `/u/${profile.username}` : '/'} />
      </div>
    </main>
  )
}
