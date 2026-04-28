'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function JumpplusForm({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [cookieInput, setCookieInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'syncing' | 'disconnecting'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setMsg('Cookie を検証中…')
    try {
      const res = await fetch('/api/jumpplus/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookieInput }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMsg(`失敗: ${json.error ?? res.status}${json.detail ? ' — ' + json.detail : ''}`)
        return
      }
      setMsg(`保存しました · ${json.cookies} 個の Cookie`)
      setCookieInput('')
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
      setMsg(`+${json.added} 件`)
      startTransition(() => router.refresh())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'sync_failed')
    } finally {
      setStatus('idle')
    }
  }

  async function disconnect() {
    if (!confirm('保存されている Jump+ の Cookie を削除します。よろしいですか？')) return
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
      setCookieInput('')
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

      <details className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-5 text-xs leading-relaxed">
        <summary className="cursor-pointer font-bold tracking-[0.18em] uppercase text-white/70">
          Cookie の取り出し方
        </summary>
        <ol className="list-decimal list-inside space-y-2 mt-4 text-white/70">
          <li>普段使っているブラウザで <a href="https://shonenjumpplus.com/mypage" target="_blank" rel="noreferrer" className="underline hover:text-white">https://shonenjumpplus.com/mypage</a> を開いてログイン状態を確認</li>
          <li>F12（または右クリック → 検証）で DevTools を開く</li>
          <li><strong className="text-white">Network</strong> タブ → ページを再読み込み（Ctrl/Cmd + R）</li>
          <li>左の一覧から <code className="text-white">mypage</code> や <code className="text-white">shonenjumpplus.com</code> 宛のリクエストをクリック</li>
          <li>右ペイン <strong className="text-white">Headers</strong> → <strong className="text-white">Request Headers</strong> から <strong className="text-white">Cookie:</strong> 行の値を全部コピー</li>
          <li>下の欄に貼り付けて「保存」</li>
        </ol>
        <p className="mt-3 text-white/40">
          Cookie は AES-256-GCM で暗号化して保存されます。期限切れになると同期が止まり、ここに「expired」と表示されるので再貼り付けしてください（ジャンプ+ の session は通常 ~30 日）。
        </p>
      </details>

      <form onSubmit={save} className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-bold tracking-[0.18em] uppercase text-white/50 mb-3">
            {hasExisting ? '再貼り付け / 上書き' : 'Cookie を貼り付け'}
          </p>
          <textarea
            required
            placeholder="ETKR=abc123; SESSION=def456; cf_clearance=...; _ga=GA1.1.0.0;"
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            rows={5}
            className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-xs font-mono placeholder-white/30 focus:outline-none focus:border-white/40 resize-none break-all"
          />
        </div>

        <button
          type="submit"
          disabled={status !== 'idle' || cookieInput.trim().length < 8}
          className="w-full rounded-xl bg-[#b53d5f] hover:bg-[#c54a6e] py-3.5 font-serif italic disabled:opacity-50"
        >
          {status === 'saving' ? '検証中…' : '保存して連携を開始'}
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
