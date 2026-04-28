'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Category = 'music' | 'book' | 'film' | 'comic' | 'live_event' | 'game'

const CATEGORY_LABELS: Record<Category, string> = {
  music: '音楽',
  book: '本',
  film: '映画',
  comic: '漫画',
  live_event: 'ライブ',
  game: 'ゲーム',
}

const SOURCE_LABELS: Record<string, string> = {
  spotify_recent: 'Spotify · 再生',
  spotify_saved: 'Spotify · 保存',
  gmail_amazon: 'Amazon メール',
  gmail_eplus: 'イープラス',
  url: 'URL 貼付',
  manual: '手動入力',
  image_upload: '画像アップロード',
  share_sheet: 'シェア',
  barcode: 'バーコード',
}

export type ManageItem = {
  id: string
  category: Category
  title: string
  creator: string | null
  cover_image_url: string | null
  source: string
  source_url: string | null
  added_at: string
}

export function ManageList({ items }: { items: ManageItem[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function deleteItem(id: string) {
    setPendingId(id)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErrorMsg(`削除に失敗: ${json.error ?? res.status}`)
        return
      }
      startTransition(() => router.refresh())
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'delete_failed')
    } finally {
      setPendingId(null)
      setConfirmId(null)
    }
  }

  return (
    <div>
      {errorMsg && (
        <p className="mb-4 text-xs text-red-400">{errorMsg}</p>
      )}
      <ul className="divide-y divide-white/10">
        {items.map((item) => (
          <li key={item.id} className="py-4 flex gap-4 items-center">
            <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-white/5 flex items-center justify-center">
              {item.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.cover_image_url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span className="text-xs text-white/30 font-serif italic">no img</span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[9px] font-medium tracking-[0.18em] uppercase text-white/40">
                  {CATEGORY_LABELS[item.category]}
                </span>
                <span className="text-[9px] tracking-wide text-white/30">·</span>
                <span className="text-[9px] tracking-wide text-white/30">
                  {SOURCE_LABELS[item.source] ?? item.source}
                </span>
              </div>
              <p className="font-serif text-sm leading-tight truncate">{item.title}</p>
              {item.creator && (
                <p className="text-xs text-white/50 mt-0.5 truncate">{item.creator}</p>
              )}
            </div>

            {confirmId === item.id ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => deleteItem(item.id)}
                  disabled={pendingId === item.id}
                  className="text-xs font-medium tracking-wide px-3 py-1.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-200 disabled:opacity-50"
                >
                  {pendingId === item.id ? '…' : '削除する'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="text-xs text-white/40 hover:text-white/70 px-2"
                >
                  キャンセル
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(item.id)}
                className="text-xs font-medium text-white/40 hover:text-white/80 transition px-2 py-1"
                aria-label="削除"
              >
                削除
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
