'use client'

import { useState } from 'react'
import { browserClient } from '@/lib/supabase/browser'

export function LoginForm() {
  const supabase = browserClient()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    } else {
      setStatus('sent')
    }
  }

  async function signInWithGoogle() {
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded-xl border border-white/15 bg-white/5 p-5 text-sm leading-relaxed">
        <p className="font-bold mb-1">ログインリンクを送信しました</p>
        <p className="text-white/70">
          {email} 宛に届いたリンクをクリックしてください。届かない場合は迷惑メールフォルダもご確認ください。
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={sendMagicLink} className="space-y-3">
      <button
        type="button"
        onClick={signInWithGoogle}
        className="w-full rounded-xl border border-white/20 bg-white text-black font-bold py-3 hover:bg-white/90 transition"
      >
        Google で続ける
      </button>

      <div className="flex items-center gap-3 my-5">
        <div className="h-px flex-1 bg-white/15" />
        <span className="text-xs text-white/40">or</span>
        <div className="h-px flex-1 bg-white/15" />
      </div>

      <input
        type="email"
        required
        autoComplete="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-white/40"
      />
      <button
        type="submit"
        disabled={status === 'sending' || !email}
        className="w-full rounded-xl bg-[#ff3d7f] py-3 font-bold disabled:opacity-50 hover:bg-[#ff5a92] transition"
      >
        {status === 'sending' ? '送信中…' : 'マジックリンクを送る'}
      </button>
      {errorMsg && (
        <p className="text-xs text-red-400 mt-2">{errorMsg}</p>
      )}
    </form>
  )
}
