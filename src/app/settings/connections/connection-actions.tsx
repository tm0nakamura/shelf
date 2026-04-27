'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function ConnectionActions({ connected }: { connected: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  if (!connected) {
    return (
      <a
        href="/api/spotify/connect"
        className="rounded-lg bg-[#1db954] text-black font-bold text-sm px-4 py-2 hover:bg-[#1ed760] transition"
      >
        連携する
      </a>
    )
  }

  async function sync() {
    setSyncMsg('同期中…')
    const res = await fetch('/api/spotify/sync', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setSyncMsg(`+${json.added ?? 0}件`)
      startTransition(() => router.refresh())
    } else {
      setSyncMsg(`失敗: ${json.error ?? res.status}`)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {syncMsg && <span className="text-xs text-white/60">{syncMsg}</span>}
      <button
        type="button"
        onClick={sync}
        disabled={isPending}
        className="rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold text-sm px-4 py-2 disabled:opacity-50"
      >
        いま同期
      </button>
    </div>
  )
}
