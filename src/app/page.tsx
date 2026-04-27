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
    <main className="min-h-dvh flex flex-col items-center justify-center bg-[#1a1614] text-white px-6 text-center">
      <h1 className="text-5xl font-black tracking-tight">shelf</h1>
      <p className="mt-4 text-base text-white/60 max-w-md">
        日々触れた音楽・本・映画・漫画・ライブ・ゲームの足跡を、自動で集めて棚にする。
      </p>
      <Link
        href="/login"
        className="mt-10 inline-flex items-center justify-center rounded-full bg-[#ff3d7f] px-8 py-3 font-bold hover:bg-[#ff5a92] transition"
      >
        はじめる
      </Link>
    </main>
  )
}
