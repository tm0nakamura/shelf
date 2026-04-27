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
    <main className="min-h-dvh flex items-center justify-center bg-[#1a1614] text-white px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">shelf</h1>
          <p className="mt-2 text-sm text-white/60">
            日々触れたコンテンツの足跡を、自動で集めて棚にする。
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
