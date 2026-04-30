'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const LS_KEY = 'unext_creds_v1'

type StoredLocalCreds = {
  cookieHeader: string
  zxuid: string
  zxemp: string
  pfid?: string | null
  connectedAt: number
}

/** Write the parsed creds bundle to localStorage. Mirrors the shape the
 *  sync-passthrough endpoint expects to receive on every request. */
export function saveLocalCreds(creds: StoredLocalCreds): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LS_KEY, JSON.stringify(creds))
}

export function readLocalCreds(): StoredLocalCreds | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LS_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredLocalCreds
  } catch {
    return null
  }
}

export function ConnectForm() {
  const router = useRouter()
  const [paste, setPaste] = useState('')
  const [isPending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [stage, setStage] = useState<'idle' | 'parsing' | 'syncing'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)
    setStage('parsing')

    // Step 1 — server parses the paste and creates / updates the stub
    // connection row, then hands the parsed creds back to us. Server
    // does NOT persist the credentials.
    const parseRes = await fetch('/api/unext/connect-passthrough', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paste }),
    })
    const parseJson = await parseRes.json().catch(() => ({}))
    if (!parseRes.ok) {
      setErrorMsg(`貼り付け解析失敗: ${parseJson.error ?? parseRes.status}`)
      setStage('idle')
      return
    }
    const creds = parseJson.creds as StoredLocalCreds
    saveLocalCreds(creds)

    // Step 2 — initial sync via passthrough. The server uses the creds
    // we just sent up, doesn't persist them, and may return rotated
    // cookies which we splice back into LS.
    setStage('syncing')
    const syncRes = await fetch('/api/unext/sync-passthrough', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cookieHeader: creds.cookieHeader,
        zxuid: creds.zxuid,
        zxemp: creds.zxemp,
      }),
    })
    const syncJson = await syncRes.json().catch(() => ({}))
    if (syncRes.ok) {
      if (syncJson.rotatedCookieHeader) {
        saveLocalCreds({ ...creds, cookieHeader: syncJson.rotatedCookieHeader })
      }
      startTransition(() => router.push('/settings/connections?ok=unext'))
    } else {
      // The connection row exists, the creds are saved — sync just
      // failed. Send them to the connections page so they can retry.
      setErrorMsg(`初回同期失敗: ${syncJson.error ?? syncRes.status}（後でやり直せます）`)
      setTimeout(() => router.push('/settings/connections?ok=unext'), 1500)
    }
  }

  const submitting = stage !== 'idle' || isPending

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="block text-xs font-bold text-white/50 mb-2">cURL をここに貼り付け</span>
        <textarea
          name="paste"
          required
          rows={10}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={`curl 'https://cc.unext.jp/?zxuid=...&zxemp=...&operationName=cosmo_getHistoryAll&...' \\\n  -H 'apollographql-client-name: cosmo' \\\n  -b '_at=...; _rt=...; ...' \\\n  ...`}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
        />
      </label>
      {errorMsg && <p className="text-xs text-red-300">{errorMsg}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-white text-black font-bold text-sm px-5 py-2.5 hover:bg-white/90 transition disabled:opacity-50"
      >
        {stage === 'parsing'
          ? '解析中…'
          : stage === 'syncing'
            ? '同期中…'
            : '保存して同期'}
      </button>
    </form>
  )
}
