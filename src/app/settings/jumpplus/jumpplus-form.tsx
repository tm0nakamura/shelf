'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function JumpplusForm({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'syncing' | 'disconnecting'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setMsg('ヘッドレスブラウザでログイン確認中… (~30秒)')
    try {
      const res = await fetch('/api/jumpplus/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMsg(`失敗: ${json.error ?? res.status}`)
        return
      }
      setMsg(`OK · cookies=${json.cookies}`)
      setEmail('')
      setPassword('')
      startTransition(() => router.refresh())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'connect_failed')
    } finally {
      setStatus('idle')
    }
  }

  async function syncNow() {
    setStatus('syncing')
    setMsg('同期中…')
    try {
      const res = await fetch('/api/jumpplus/sync', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setMsg(`失敗: ${json.error ?? res.status}`)
        return
      }
      setMsg(`+${json.added} 件 (refreshed=${json.refreshed_cookies})`)
      startTransition(() => router.refresh())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'sync_failed')
    } finally {
      setStatus('idle')
    }
  }

  async function disconnect() {
    if (!confirm('保存されている Jump+ のログイン情報を削除します。よろしいですか？')) return
    setStatus('disconnecting')
    setMsg('削除中…')
    try {
      const res = await fetch('/api/jumpplus/disconnect', { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setMsg(`失敗: ${json.error ?? res.status}`)
        return
      }
      setMsg('削除しました')
      startTransition(() => router.refresh())
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div>
      {hasExisting && (
        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={syncNow}
            disabled={status !== 'idle'}
            className="flex-1 rounded-xl bg-[#b53d5f] hover:bg-[#c54a6e] py-3 font-serif italic disabled:opacity-50"
          >
            {status === 'syncing' ? '同期中…' : 'いま同期する'}
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={status !== 'idle'}
            className="rounded-xl border border-red-500/40 hover:bg-red-500/10 text-red-200 px-5 py-3 text-sm font-medium tracking-wide disabled:opacity-50"
          >
            連携解除
          </button>
        </div>
      )}

      <form onSubmit={save} className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-bold tracking-[0.18em] uppercase text-white/50 mb-3">
            {hasExisting ? '再ログイン / 上書き' : '初回ログイン'}
          </p>
          <input
            type="email"
            required
            placeholder="Jump+ のメールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-white/40 mb-3"
          />
          <input
            type="password"
            required
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-white/40"
          />
        </div>

        <button
          type="submit"
          disabled={status !== 'idle' || !email || !password}
          className="w-full rounded-xl bg-[#b53d5f] hover:bg-[#c54a6e] py-3.5 font-serif italic disabled:opacity-50"
        >
          {status === 'saving' ? '確認中…' : 'ログインを保存して連携を開始'}
        </button>

        {msg && (
          <p className={`text-xs mt-2 ${msg.startsWith('失敗') ? 'text-red-400' : 'text-white/60'}`}>
            {msg}
          </p>
        )}
      </form>
    </div>
  )
}
