import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './login-form'

export default async function LoginPage() {
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
    <main className="min-h-dvh flex items-center justify-center bg-[#14110f] text-white px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <h1 className="font-serif text-5xl font-light italic tracking-tight">shelf</h1>
          <p className="mt-3 text-sm text-white/55 leading-relaxed">
            日々触れたコンテンツの足跡を、<br />自動で集めて棚にする。
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
