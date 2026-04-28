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

      <details className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-5 text-xs leading-relaxed" open>
        <summary className="cursor-pointer font-bold tracking-[0.18em] uppercase text-white/70">
          Cookie の取り出し方（おすすめ：Application タブ）
        </summary>

        <ol className="list-decimal list-inside space-y-2 mt-4 text-white/75">
          <li>
            普段使っているブラウザで{' '}
            <a
              href="https://shonenjumpplus.com/mypage"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-white"
            >
              shonenjumpplus.com/mypage
            </a>
            {' '}を開く（ログインしておく）
          </li>
          <li>
            <kbd className="text-white">F12</kbd>{' '}
            （Mac: <kbd className="text-white">Cmd + Option + I</kbd>）で DevTools を開く
          </li>
          <li>
            上のタブから <strong className="text-white">Application</strong>
            （Firefox は <strong className="text-white">ストレージ</strong>、Safari は <strong className="text-white">ストレージ</strong>） を選ぶ。
            タブが見えなければ DevTools の右上 <kbd>≫</kbd> をクリックすると出る
          </li>
          <li>
            左サイドバー → <strong className="text-white">Cookies</strong> → <strong className="text-white">https://shonenjumpplus.com</strong> をクリック
          </li>
          <li>
            右に <strong className="text-white">Name / Value</strong> の表が並ぶ。
            <strong className="text-white">表の中をどこか1セルクリック → Cmd/Ctrl + A で全選択 → Cmd/Ctrl + C でコピー</strong>
          </li>
          <li>
            下の欄に貼り付けて「保存」
          </li>
        </ol>

        <details className="mt-4 ml-2">
          <summary className="cursor-pointer text-white/50 hover:text-white">
            別ルート：Network タブから取る
          </summary>
          <ol className="list-decimal list-inside space-y-1.5 mt-2 ml-3 text-white/60">
            <li><strong className="text-white">Network</strong> タブを開いてページを再読み込み</li>
            <li>一覧から <code>mypage</code> リクエストをクリック</li>
            <li>右の <strong>Headers</strong> 欄を下にスクロール → <strong>Request Headers</strong> の <strong>Cookie:</strong> 行をコピー</li>
          </ol>
        </details>

        <p className="mt-4 text-white/40">
          表 / 一行 / セミコロン区切り — どの形式で貼っても OK です。
          Cookie は AES-256-GCM で暗号化して保存。期限切れ（〜30日）になると status が
          <code className="text-yellow-300/80"> expired </code>
          になるので再貼り付けしてください。
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
