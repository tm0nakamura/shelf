'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'

type Step = 'email' | 'code' | 'verifying' | 'error'

export function LoginForm() {
  const supabase = browserClient()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [sending, setSending] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setSending(false)
    if (error) {
      setStep('error')
      setErrorMsg(error.message)
    } else {
      setStep('code')
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setStep('verifying')
    setErrorMsg(null)
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    })
    if (error) {
      setStep('code')
      setErrorMsg(error.message)
    } else {
      // Session now stored in cookies. Land on / and let the root route
      // resolve the username and forward to /u/[username].
      router.push('/')
      router.refresh()
    }
  }

  async function signInWithGoogle() {
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
    if (error) {
      setStep('error')
      setErrorMsg(error.message)
    }
  }

  // === Step 2: code input ===
  if (step === 'code' || step === 'verifying') {
    return (
      <form onSubmit={verifyCode} className="space-y-3">
        <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm leading-relaxed">
          <p className="font-bold mb-1">メールを送信しました</p>
          <p className="text-white/70 text-xs">
            {email} に届いた **6桁の数字コード** を入力するか、メール内のリンクをクリックしてください。
          </p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] placeholder-white/20 focus:outline-none focus:border-white/40"
          autoFocus
        />

        <button
          type="submit"
          disabled={code.length !== 6 || step === 'verifying'}
          className="w-full rounded-xl bg-[#ff3d7f] py-3 font-bold disabled:opacity-50 hover:bg-[#ff5a92] transition"
        >
          {step === 'verifying' ? '確認中…' : 'コードでログイン'}
        </button>

        {errorMsg && (
          <p className="text-xs text-red-400">{errorMsg}</p>
        )}

        <button
          type="button"
          onClick={() => { setStep('email'); setCode(''); setErrorMsg(null) }}
          className="w-full text-xs text-white/50 hover:text-white pt-2"
        >
          ← メールアドレスを変える
        </button>
      </form>
    )
  }

  // === Step 1: email entry (default) ===
  return (
    <form onSubmit={sendOtp} className="space-y-3">
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
        disabled={sending || !email}
        className="w-full rounded-xl bg-[#ff3d7f] py-3 font-bold disabled:opacity-50 hover:bg-[#ff5a92] transition"
      >
        {sending ? '送信中…' : 'コード or リンクを送る'}
      </button>
      {errorMsg && (
        <p className="text-xs text-red-400 mt-2">{errorMsg}</p>
      )}
    </form>
  )
}
