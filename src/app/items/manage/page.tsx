import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ManageList } from './manage-list'

export default async function ManageItemsPage() {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) redirect('/login')

  const [{ data: profile }, { data: items }] = await Promise.all([
    supabase
      .from('users')
      .select('username')
      .eq('id', userRes.user.id)
      .maybeSingle(),
    supabase
      .from('items')
      .select('id, category, title, creator, cover_image_url, source, source_url, added_at')
      .eq('user_id', userRes.user.id)
      .order('added_at', { ascending: false })
      .limit(500),
  ])

  return (
    <main className="min-h-dvh bg-[#14110f] text-white px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-baseline justify-between mb-8">
          <h1 className="font-serif text-3xl font-light italic">アイテム管理</h1>
          {profile?.username && (
            <Link
              href={`/u/${profile.username}`}
              className="text-xs font-medium tracking-wide text-white/50 hover:text-white"
            >
              ← 棚にもどる
            </Link>
          )}
        </div>

        <p className="text-sm text-white/55 mb-8 leading-relaxed">
          手動で追加したアイテムや、Amazon メールから取り込んだアイテムを一覧・削除できます。
        </p>

        {(!items || items.length === 0) ? (
          <p className="text-sm text-white/40 italic font-serif text-center py-16">
            まだアイテムがありません。
          </p>
        ) : (
          <ManageList items={items.map((it) => ({
            id: it.id,
            category: it.category as 'music' | 'book' | 'film' | 'anime' | 'drama' | 'comic' | 'live_event' | 'game',
            title: it.title,
            creator: it.creator,
            cover_image_url: it.cover_image_url,
            source: it.source,
            source_url: it.source_url,
            added_at: it.added_at,
          }))} />
        )}
      </div>
    </main>
  )
}
