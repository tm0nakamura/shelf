import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Shelf, type Category, type ShelfData, type ShelfItem } from '@/components/shelf/Shelf'

const ALL_CATEGORIES: Category[] = ['music', 'book', 'film', 'comic', 'live_event', 'game']

export default async function ShelfPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('id, username, display_name, theme')
    .eq('username', username)
    .maybeSingle()

  if (!profile) notFound()

  // Fetch all items, then pick a featured one per category.
  // Phase 1: featured = most recently consumed.
  const { data: items } = await supabase
    .from('items')
    .select('id, category, title, creator, cover_image_url, consumed_at, added_at')
    .eq('user_id', profile.id)
    .order('consumed_at', { ascending: false, nullsFirst: false })
    .limit(500)

  const itemList = items ?? []

  const featured: Partial<Record<Category, ShelfItem>> = {}
  const connectedCategories: Category[] = []
  for (const c of ALL_CATEGORIES) {
    const first = itemList.find((it) => it.category === c)
    if (first) {
      featured[c] = {
        id: first.id,
        category: first.category as Category,
        title: first.title,
        creator: first.creator,
        cover_image_url: first.cover_image_url,
        consumed_at: first.consumed_at,
      }
      connectedCategories.push(c)
    }
  }

  // Stats — Phase 1: simple counts.
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
    featured,
    connectedCategories,
  }

  return (
    <div className="min-h-dvh bg-[#1a1614] py-6 sm:py-12">
      <Shelf data={data} />
    </div>
  )
}
