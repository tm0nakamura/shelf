'use client'

import { useState } from 'react'
import styles from './shelf.module.css'

export type Category = 'music' | 'book' | 'film' | 'comic' | 'live_event' | 'game'

export type ShelfItem = {
  id: string
  category: Category
  title: string
  creator: string | null
  cover_image_url: string | null
  consumed_at: string | null
  acquired_at?: string | null
  source_url?: string | null
}

export type ShelfStats = {
  music_tracks: number
  live_count: number
  book_count: number
  listen_hours: number
}

export type ShelfData = {
  username: string
  display_name: string
  theme: 'ami' | 'haru' | 'ren'
  stats: ShelfStats
  /** Items per category, sorted most-recent first. Featured = first element. */
  byCategory: Partial<Record<Category, ShelfItem[]>>
  /** Categories with at least one item. */
  connectedCategories: Category[]
}

const CATEGORY_LABELS: Record<Category, string> = {
  music: '音楽',
  live_event: 'ライブ',
  book: '本',
  film: '映画',
  comic: '漫画',
  game: 'ゲーム',
}

const CATEGORY_ICONS: Record<Category, string> = {
  music: '♪',
  live_event: '▶',
  book: '▤',
  film: '▣',
  comic: '◫',
  game: '⌘',
}

const CATEGORY_HINT_SVCS: Record<Category, string> = {
  music: 'Spotify・Apple Music',
  book: 'Kindle・シェアで追加',
  film: 'シェアで追加',
  comic: 'Kindle・シェアで追加',
  live_event: 'シェアで追加',
  game: 'Steam・シェアで追加',
}

const CATEGORY_COUNT_UNIT: Record<Category, string> = {
  music: 'tracks',
  book: 'books',
  film: 'films',
  comic: 'vols.',
  live_event: 'shows',
  game: 'titles',
}

const TASTE_ORDER: Category[] = ['music', 'live_event', 'book', 'film', 'comic', 'game']

export function Shelf({ data }: { data: ShelfData }) {
  const [activeTab, setActiveTab] = useState<'all' | Category>('all')

  const themeClass =
    data.theme === 'haru' ? styles.themeHaru
    : data.theme === 'ren' ? styles.themeRen
    : styles.themeAmi

  const sortedCategories = [...TASTE_ORDER].sort((a, b) => {
    const aFilled = !!data.byCategory[a]?.length
    const bFilled = !!data.byCategory[b]?.length
    if (aFilled === bFilled) return 0
    return aFilled ? -1 : 1
  })

  return (
    <div className={`${styles.phone} ${themeClass}`}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <div className={styles.avatar}>{data.display_name.slice(0, 1).toUpperCase()}</div>
          <div className={styles.name}>
            <div className={styles.handle}>{data.display_name}</div>
            <div className={styles.url}>shelf.app/{data.username}</div>
          </div>
          <div className={styles.theme} />
        </div>

        <div className={styles.statsRow}>
          <Stat v={data.stats.music_tracks} l="曲" />
          <Stat v={data.stats.live_count} l="ライブ" />
          <Stat v={data.stats.book_count} l="本" />
          <Stat v={`${data.stats.listen_hours}h`} l="視聴" />
        </div>

        <div className={styles.catRow}>
          <CatTab
            active={activeTab === 'all'}
            icon="●"
            label="ぜんぶ"
            onClick={() => setActiveTab('all')}
          />
          {data.connectedCategories.map((c) => (
            <CatTab
              key={c}
              active={activeTab === c}
              icon={CATEGORY_ICONS[c]}
              label={CATEGORY_LABELS[c]}
              onClick={() => setActiveTab(c)}
            />
          ))}
        </div>
      </header>

      <main className={styles.body}>
        {activeTab === 'all' ? (
          <div className={styles.tasteGrid}>
            {sortedCategories.map((c) => {
              const item = data.byCategory[c]?.[0]
              if (item) return <FilledCell key={c} category={c} item={item} />
              return <EmptyCell key={c} category={c} />
            })}
          </div>
        ) : (
          <CategoryDetail category={activeTab} items={data.byCategory[activeTab] ?? []} />
        )}
      </main>
    </div>
  )
}

function Stat({ v, l }: { v: number | string; l: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.v}>{v}</div>
      <div className={styles.l}>{l}</div>
    </div>
  )
}

function CatTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.cat} ${active ? styles.catActive : ''}`}
    >
      <div className={styles.catIcon}>{icon}</div>
      <div className={styles.catLabel}>{label}</div>
    </button>
  )
}

function FilledCell({ category, item }: { category: Category; item: ShelfItem }) {
  const hasCover = !!item.cover_image_url
  return (
    <div className={`${styles.tasteCell} ${hasCover ? styles.tasteCellWithCover : ''}`}>
      <span className={styles.genre}>{CATEGORY_LABELS[category]}</span>
      {hasCover ? (
        <div className={styles.coverBox}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.cover_image_url!} alt="" className={styles.coverImg} />
        </div>
      ) : null}
      <div className={styles.lbl}>
        {item.creator && <span className={styles.a}>{item.creator}</span>}
        <span className={styles.t}>{item.title}</span>
      </div>
    </div>
  )
}

function EmptyCell({ category }: { category: Category }) {
  return (
    <div className={`${styles.tasteCell} ${styles.tasteCellEmpty}`}>
      <span className={styles.genre}>{CATEGORY_LABELS[category]}</span>
      <div className={styles.placeholder}>
        <span className={styles.plus}>+</span>
        <span className={styles.cta}>連携する</span>
        <span className={styles.svc}>{CATEGORY_HINT_SVCS[category]}</span>
      </div>
    </div>
  )
}

function CategoryDetail({ category, items }: { category: Category; items: ShelfItem[] }) {
  if (items.length === 0) {
    return <div className={styles.detailEmpty}>このカテゴリはまだ空です。</div>
  }

  return (
    <>
      <div className={styles.catHead}>
        <h3>{CATEGORY_LABELS[category]}</h3>
        <span className={styles.catMeta}>
          {items.length} {CATEGORY_COUNT_UNIT[category]}
        </span>
      </div>

      {category === 'live_event'
        ? <TicketRow items={items} />
        : <FeatureLayout items={items} />
      }
    </>
  )
}

function FeatureLayout({ items }: { items: ShelfItem[] }) {
  const [feature, ...rest] = items
  const grid = rest.slice(0, 4)

  return (
    <>
      <div className={styles.feature}>
        {feature.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={feature.cover_image_url} alt="" className={styles.cover} />
        )}
        <div className={styles.lbl}>
          {feature.creator && <span className={styles.a}>{feature.creator}</span>}
          <span className={styles.t}>{feature.title}</span>
        </div>
      </div>

      {grid.length > 0 && (
        <div className={styles.grid2}>
          {grid.map((item) => (
            <div key={item.id} className={styles.card}>
              {item.cover_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.cover_image_url} alt="" className={styles.cover} />
              )}
              <div className={styles.lbl}>
                {item.creator && <span className={styles.a}>{item.creator}</span>}
                <span className={styles.t}>{item.title}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function TicketRow({ items }: { items: ShelfItem[] }) {
  return (
    <div className={styles.tktRow}>
      {items.slice(0, 8).map((item) => (
        <div key={item.id} className={styles.tkt}>
          <div className={styles.tktDate}>
            {formatTicketDate(item.consumed_at ?? item.acquired_at ?? null)}
          </div>
          <div className={styles.tktBar} />
          <div className={styles.tktInfo}>
            <div className={styles.show}>{item.title}</div>
            {item.creator && <div className={styles.venue}>{item.creator}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatTicketDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getDate()).padStart(2, '0')}`
}
