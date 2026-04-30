import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Shelf, type Category, type ShelfData, type ShelfItem } from '@/components/shelf/Shelf'

const ALL_CATEGORIES: Category[] = ['music', 'book', 'film', 'anime', 'drama', 'comic', 'live_event', 'game']

export default async function ShelfPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await createClient()

  // Phase 3 privacy lockdown: the shelf is now strictly private.
  // Unauthenticated visitors get bounced to /login; logged-in users
  // who try to peek at someone else's URL hit notFound (we don't even
  // confirm whether the username exists).
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, username, display_name, theme')
    .eq('username', username)
    .maybeSingle()

  // RLS on `users` only returns auth.uid()'s own row, so any non-owner
  // lookup yields null here and falls into notFound naturally — but we
  // also gate explicitly in case RLS gets relaxed later.
  if (!profile || userRes.user.id !== profile.id) {
    notFound()
  }

  const isOwner = true

  // Pull a generous slice of recent items, then bucket them per category.
  // We sort by consumed_at desc with acquired_at / added_at fallbacks so the
  // first element of each bucket becomes the featured card.
  const { data: items } = await supabase
    .from('items')
    .select('id, category, title, creator, cover_image_url, consumed_at, acquired_at, added_at, source_url')
    .eq('user_id', profile.id)
    .order('consumed_at', { ascending: false, nullsFirst: false })
    .order('acquired_at', { ascending: false, nullsFirst: false })
    .order('added_at', { ascending: false })
    .limit(500)

  const itemList = items ?? []

  const byCategory: Partial<Record<Category, ShelfItem[]>> = {}
  const connectedCategories: Category[] = []
  for (const c of ALL_CATEGORIES) {
    const bucket: ShelfItem[] = itemList
      .filter((it) => it.category === c)
      .map((it) => ({
        id: it.id,
        category: it.category as Category,
        title: it.title,
        creator: it.creator,
        cover_image_url: it.cover_image_url,
        consumed_at: it.consumed_at,
        acquired_at: it.acquired_at,
        source_url: it.source_url,
      }))
    if (bucket.length > 0) {
      byCategory[c] = bucket
      connectedCategories.push(c)
    }
  }

  const stats = {
    music_tracks: itemList.filter((it) => it.category === 'music').length,
    live_count: itemList.filter((it) => it.category === 'live_event').length,
    book_count: itemList.filter((it) => it.category === 'book').length,
    listen_hours: 0,  // No duration data yet; FR-13 will compute
  }

  const data: ShelfData = {
    username: profile.username,
    display_name: profile.display_name,
    theme: (profile.theme === 'haru' || profile.theme === 'ren') ? profile.theme : 'ami',
    stats,
    byCategory,
    connectedCategories,
  }

  return (
    <div className="min-h-dvh bg-[#14110f] py-6 sm:py-12 relative">
      <Shelf data={data} />
      {isOwner && (
        <div className="fixed bottom-6 right-6 sm:bottom-10 sm:right-10 z-50 flex items-center gap-2">
          <Link
            href="/settings/connections"
            aria-label="連携・設定"
            className="rounded-full border border-white/15 hover:border-white/30 hover:bg-white/5 text-white/70 hover:text-white text-xs font-medium tracking-wide px-4 py-3 backdrop-blur-md bg-black/20 transition"
          >
            設定
          </Link>
          <Link
            href="/items/manage"
            aria-label="アイテム管理"
            className="rounded-full border border-white/15 hover:border-white/30 hover:bg-white/5 text-white/70 hover:text-white text-xs font-medium tracking-wide px-4 py-3 backdrop-blur-md bg-black/20 transition"
          >
            管理
          </Link>
          <Link
            href="/items/new"
            aria-label="アイテムを追加"
            className="flex items-center gap-2.5 rounded-full bg-[#b53d5f] hover:bg-[#c54a6e] text-[#fcf3e8] font-serif italic px-6 py-3 shadow-[0_10px_30px_-8px_rgba(181,61,95,0.55),0_4px_10px_-2px_rgba(0,0,0,0.3)] transition"
          >
            <span className="text-lg leading-none -mt-px">+</span>
            <span className="text-sm tracking-wide">追加</span>
          </Link>
        </div>
      )}
    </div>
  )
}
