'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Category = 'music' | 'book' | 'film' | 'anime' | 'drama' | 'comic' | 'live_event' | 'game'

const CATEGORY_OPTIONS: Array<{ value: Category; label: string; icon: string }> = [
  { value: 'music', label: '音楽', icon: '♪' },
  { value: 'book', label: '本', icon: '▤' },
  { value: 'film', label: '映画', icon: '▣' },
  { value: 'anime', label: 'アニメ', icon: '✦' },
  { value: 'drama', label: 'ドラマ', icon: '◐' },
  { value: 'comic', label: '漫画', icon: '◫' },
  { value: 'live_event', label: 'ライブ', icon: '▶' },
  { value: 'game', label: 'ゲーム', icon: '⌘' },
]

export function NewItemForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [creator, setCreator] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [category, setCategory] = useState<Category>('book')
  const [source, setSource] = useState<'url' | 'manual'>('url')

  const [fetching, setFetching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [fetchedHint, setFetchedHint] = useState<string | null>(null)

  async function fetchOgpFromUrl() {
    if (!url.trim()) return
    setFetching(true)
    setErrorMsg(null)
    setFetchedHint(null)
    try {
      const res = await fetch('/api/ogp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(`URL から情報を取れませんでした: ${json.error ?? res.status}`)
        return
      }
      if (json.title) setTitle(json.title)
      if (json.creator) setCreator(json.creator)
      if (json.image) setCoverImageUrl(json.image)
      if (json.category) setCategory(json.category as Category)
      setFetchedHint(`${json.siteName ?? 'サイト'} から取得`)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'fetch_failed')
    } finally {
      setFetching(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setErrorMsg('タイトルを入力してください')
      return
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          category,
          title: title.trim(),
          creator: creator.trim() || null,
          cover_image_url: coverImageUrl.trim() || null,
          source_url: url.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(`登録に失敗: ${json.error ?? res.status}`)
        return
      }
      startTransition(() => {
        router.push(redirectTo)
        router.refresh()
      })
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'submit_failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* mode toggle */}
      <div className="flex gap-2">
        {(['url', 'manual'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSource(m)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${
              source === m
                ? 'bg-white text-black'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {m === 'url' ? 'URL から取得' : '手動入力'}
          </button>
        ))}
      </div>

      {/* URL input — only used as a fetch source when source=url */}
      {source === 'url' && (
        <div>
          <label className="text-xs font-bold text-white/50 block mb-1.5">
            アイテムの URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => { if (url.trim()) fetchOgpFromUrl() }}
              placeholder="https://..."
              className="flex-1 rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-white/40"
            />
            <button
              type="button"
              onClick={fetchOgpFromUrl}
              disabled={fetching || !url.trim()}
              className="px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold disabled:opacity-50"
            >
              {fetching ? '…' : '取得'}
            </button>
          </div>
          {fetchedHint && (
            <p className="text-xs text-emerald-300/80 mt-1.5">✓ {fetchedHint}</p>
          )}
        </div>
      )}

      {/* category */}
      <div>
        <label className="text-xs font-bold text-white/50 block mb-1.5">カテゴリ</label>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCategory(opt.value)}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition ${
                category === opt.value
                  ? 'bg-[#ff3d7f] text-white'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* title */}
      <div>
        <label className="text-xs font-bold text-white/50 block mb-1.5">タイトル *</label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm focus:outline-none focus:border-white/40"
        />
      </div>

      {/* creator */}
      <div>
        <label className="text-xs font-bold text-white/50 block mb-1.5">
          作者 / アーティスト / 監督（任意）
        </label>
        <input
          type="text"
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm focus:outline-none focus:border-white/40"
        />
      </div>

      {/* cover image */}
      <div>
        <label className="text-xs font-bold text-white/50 block mb-1.5">
          カバー画像 URL（任意）
        </label>
        <input
          type="url"
          value={coverImageUrl}
          onChange={(e) => setCoverImageUrl(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-white/40"
        />
        {coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt="プレビュー"
            className="mt-2 rounded-lg max-h-32 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>

      {errorMsg && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={submitting || !title.trim()}
        className="w-full rounded-xl bg-[#ff3d7f] py-3.5 font-bold disabled:opacity-50 hover:bg-[#ff5a92] transition"
      >
        {submitting ? '登録中…' : '棚に追加'}
      </button>
    </form>
  )
}
