'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const UNEXT_LS_KEY = 'unext_creds_v1'

type UnextLocalCreds = {
  cookieHeader: string
  zxuid: string
  zxemp: string
  pfid?: string | null
  connectedAt: number
}

function readUnextLocalCreds(): UnextLocalCreds | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(UNEXT_LS_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UnextLocalCreds
  } catch {
    return null
  }
}

function writeUnextLocalCreds(creds: UnextLocalCreds): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(UNEXT_LS_KEY, JSON.stringify(creds))
}

export function SteamActions({ connected }: { connected: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  if (!connected) {
    return (
      <a
        href="/api/steam/connect"
        className="rounded-lg bg-[#1b2838] hover:bg-[#2a475e] text-white font-bold text-sm px-4 py-2 transition border border-[#66c0f4]/30"
      >
        連携する
      </a>
    )
  }

  async function sync() {
    setSyncMsg('同期中…')
    const res = await fetch('/api/steam/sync', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      const tag =
        json.private_profile
          ? '⚠ profile private'
          : `+${json.added ?? 0} (recent ${json.recently_played ?? 0})`
      setSyncMsg(tag)
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

export function UnextActions({ connected }: { connected: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [hasLocalCreds, setHasLocalCreds] = useState<boolean | null>(null)

  useEffect(() => {
    setHasLocalCreds(!!readUnextLocalCreds())
  }, [])

  if (!connected) {
    return (
      <a
        href="/settings/unext/connect"
        className="rounded-lg bg-[#000a17] hover:bg-[#0a1730] text-white font-bold text-sm px-4 py-2 transition border border-[#0080de]/40"
      >
        連携する
      </a>
    )
  }

  // Connection row exists in DB but localStorage is empty — happens when
  // the user is on a different browser / cleared their LS / switched
  // device. Nudge them to re-paste; we can't sync without local creds.
  if (hasLocalCreds === false) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-amber-300/80">この端末には Cookie 未保存</span>
        <a
          href="/settings/unext/connect"
          className="rounded-lg bg-white text-black font-bold text-sm px-4 py-2 hover:bg-white/90 transition"
        >
          再連携
        </a>
      </div>
    )
  }

  async function sync() {
    const creds = readUnextLocalCreds()
    if (!creds) {
      setSyncMsg('Cookie 未保存。再連携してください')
      setHasLocalCreds(false)
      return
    }
    setSyncMsg('同期中…')
    const res = await fetch('/api/unext/sync-passthrough', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookieHeader: creds.cookieHeader,
        zxuid: creds.zxuid,
        zxemp: creds.zxemp,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      // Persist any rotation back into LS so next sync uses fresh tokens.
      if (json.rotatedCookieHeader) {
        writeUnextLocalCreds({ ...creds, cookieHeader: json.rotatedCookieHeader })
      }
      setSyncMsg(
        `+${json.added ?? 0}件 (映画 ${json.episodes ?? 0} / アニメ ${json.anime ?? 0} / ドラマ ${json.drama ?? 0} / 漫画 ${json.comics ?? 0} / 書籍 ${json.books ?? 0})`,
      )
      startTransition(() => router.refresh())
    } else {
      const msg = String(json.error ?? res.status)
      if (
        /token_expired|token expired|_at_missing|unauthorized|unauthenticated|invalid_token|401|403/i.test(
          msg,
        )
      ) {
        setSyncMsg('セッション切れ。「Cookie 更新」から貼り直してください')
      } else {
        setSyncMsg(`失敗: ${msg.slice(0, 80)}`)
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      {syncMsg && <span className="text-xs text-white/60">{syncMsg}</span>}
      <a
        href="/settings/unext/connect"
        className="rounded-lg border border-white/10 hover:bg-white/10 text-white/70 hover:text-white text-xs px-3 py-2"
      >
        Cookie 更新
      </a>
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

export function GmailActions({ connected }: { connected: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  if (!connected) {
    return (
      <a
        href="/api/gmail/connect"
        className="rounded-lg bg-[#ea4335] text-white font-bold text-sm px-4 py-2 hover:bg-[#d63a2c] transition"
      >
        連携する
      </a>
    )
  }

  async function sync() {
    setSyncMsg('同期中…')
    const res = await fetch('/api/gmail/sync', { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setSyncMsg(`+${json.added ?? 0}件 / 失敗 ${json.failed ?? 0}`)
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
