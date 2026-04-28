import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()

  if (data.user) {
    const { data: profile } = await supabase
      .from('users')
      .select('username')
      .eq('id', data.user.id)
      .maybeSingle()
    if (profile?.username) {
      redirect(`/u/${profile.username}`)
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center bg-[#14110f] text-white px-6 text-center">
      <h1 className="font-serif text-7xl font-light italic tracking-tight">
        shelf
      </h1>
      <p className="mt-6 text-sm text-white/55 max-w-md leading-relaxed tracking-wide">
        日々触れた音楽・本・映画・漫画・ライブ・ゲームの足跡を、<br />
        自動で集めて棚にする。
      </p>
      <Link
        href="/login"
        className="mt-12 inline-flex items-center justify-center rounded-full border border-white/30 hover:border-white/60 hover:bg-white/5 px-10 py-3 text-sm font-medium tracking-[0.2em] uppercase transition"
      >
        はじめる
      </Link>
    </main>
  )
}
