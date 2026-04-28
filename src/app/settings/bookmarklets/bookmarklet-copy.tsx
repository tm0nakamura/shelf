'use client'

import { useState } from 'react'

const BOOKMARKLETS = [
  {
    key: 'jumpplus',
    label: '少年ジャンプ+ → shelf',
    description:
      'ジャンプ+の マイページ / お気に入り を開いた状態でクリック → 「漫画」カテゴリにアイテムが入ります。',
    where: 'shonenjumpplus.com/mypage',
  },
] as const

export function BookmarkletCopy({
  appUrl,
  token,
}: {
  appUrl: string
  token: string
}) {
  return (
    <ul className="space-y-6">
      {BOOKMARKLETS.map((bm) => (
        <BookmarkletRow
          key={bm.key}
          appUrl={appUrl}
          token={token}
          bookmark={bm}
        />
      ))}

      <li className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-xs leading-relaxed text-white/55">
        <p className="font-bold text-white/80 mb-2">使い方</p>
        <ol className="list-decimal list-inside space-y-1.5">
          <li>各リンクを <strong className="text-white">ブックマークバーにドラッグ</strong> して保存（または右クリック → ブックマークに追加）。</li>
          <li>対象サービスにログイン中のページで、保存したブックマークをクリック。</li>
          <li>右上に「N 件を棚に追加しました」と出れば成功。</li>
        </ol>
        <p className="mt-3 text-white/40">
          ※ トークンが URL に含まれているので、第三者には共有しないでください。
          流出した時は Vercel 側で <code className="text-white/70">IMPORT_API_TOKEN</code> を再生成すれば古い bookmarklet は無効になります。
        </p>
      </li>
    </ul>
  )
}

function BookmarkletRow({
  appUrl,
  token,
  bookmark,
}: {
  appUrl: string
  token: string
  bookmark: { key: string; label: string; description: string; where: string }
}) {
  const [copied, setCopied] = useState(false)
  const cleanAppUrl = appUrl.replace(/\/$/, '')
  const src = `${cleanAppUrl}/bm/${bookmark.key}?t=${encodeURIComponent(token)}`
  const code = `javascript:(()=>{const s=document.createElement('script');s.src='${src}&_='+Date.now();document.body.appendChild(s);})()`

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-serif text-lg italic">{bookmark.label}</h3>
        <span className="text-[10px] tracking-[0.16em] uppercase text-white/40">
          {bookmark.where}
        </span>
      </div>
      <p className="text-xs text-white/55 leading-relaxed mb-4">
        {bookmark.description}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href={code}
          // The browser stores `href` verbatim when dragged to the bookmark bar.
          // Don't navigate when clicked — instruct user to drag instead.
          onClick={(e) => e.preventDefault()}
          className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-[#b53d5f] hover:bg-[#c54a6e] text-[#fcf3e8] font-serif italic px-5 py-2 text-sm cursor-grab active:cursor-grabbing"
          draggable
          title="ブックマークバーにドラッグ"
        >
          <span aria-hidden>📚</span>
          <span>{bookmark.label}</span>
        </a>

        <button
          type="button"
          onClick={copy}
          className="text-xs font-medium tracking-wide text-white/55 hover:text-white px-3 py-2 rounded-md border border-white/10 hover:border-white/30"
        >
          {copied ? 'コピーしました' : 'コードをコピー'}
        </button>
      </div>

      <details className="mt-4">
        <summary className="text-xs text-white/40 cursor-pointer hover:text-white/70">
          中身を見る
        </summary>
        <pre className="mt-2 text-[11px] leading-relaxed text-white/40 break-all whitespace-pre-wrap p-3 bg-black/30 rounded-md font-mono">
          {code}
        </pre>
      </details>
    </li>
  )
}
