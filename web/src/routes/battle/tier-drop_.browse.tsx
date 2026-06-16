import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faLayerGroup,
  faMagnifyingGlass,
  faUser,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { TierListSkeleton } from '~/components/Skeletons'
import { ogMeta } from '~/lib/games/ogMeta'
import { fetchTierFeed, fetchTierScopes } from '~/lib/games/serverFns'
import type { TierFeedRow, TierScopeCatalog } from '~/lib/games/types'

type ScopeOption = { boardId: string; label: string; axis: string }
const flattenScopes = (s: TierScopeCatalog): ScopeOption[] => [
  ...s.champions.map((o) => ({ ...o, axis: 'champion' })),
  ...s.lines.map((o) => ({ ...o, axis: 'line' })),
  ...s.years.map((o) => ({ ...o, axis: 'year' })),
  ...s.prices.map((o) => ({ ...o, axis: 'price' })),
  ...s.rarities.map((o) => ({ ...o, axis: 'rarity' })),
]

export const Route = createFileRoute('/battle/tier-drop_/browse')({
  loader: async () => ({ feed: await fetchTierFeed({ data: {} }) }),
  head: () => {
    const title = 'Community Tier Lists · Skin Battle'
    const description =
      'Browse every tier list the community has ranked, by champion, skin line, year, price, or rarity.'
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        ...ogMeta({ title, description, path: '/battle/tier-drop/browse', card: 'tier-list' as const }),
      ],
    }
  },
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load tier lists"
      message={error.message}
      back={{ to: '/battle/tier-drop', label: 'Back to Tier Drop' }}
    />
  ),
  pendingComponent: () => <TierListSkeleton />,
  component: BrowsePage,
})

const AXIS_TONE: Record<string, string> = {
  champion: 'bg-gold5/20 text-gold1 outline-gold2/40',
  line: 'bg-blue5/30 text-blue1 outline-blue3/40',
  year: 'bg-[#3fa05a]/15 text-[#7fd49a] outline-[#3fa05a]/40',
  price: 'bg-[#d98a2b]/15 text-[#e8b365] outline-[#d98a2b]/40',
  rarity: 'bg-[#a25afd]/15 text-[#c9a3f0] outline-[#a25afd]/40',
}
const AXIS_LABEL: Record<string, string> = {
  champion: 'Champion',
  line: 'Skin line',
  year: 'Year',
  price: 'Price',
  rarity: 'Rarity',
}

// Client-only relative time (avoids an SSR/client hydration mismatch).
function TimeAgo({ iso }: { iso: string }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const diff = Date.now() - Date.parse(iso)
    const m = Math.round(diff / 60000)
    setText(
      m < 1
        ? 'just now'
        : m < 60
          ? `${m}m ago`
          : m < 1440
            ? `${Math.round(m / 60)}h ago`
            : `${Math.round(m / 1440)}d ago`,
    )
  }, [iso])
  return <span className="tabular-nums">{text}</span>
}

function FeedRow({ row }: { row: TierFeedRow }) {
  const tone = AXIS_TONE[row.boardType] ?? AXIS_TONE.champion
  return (
    <Link
      to="/battle/tier-drop"
      search={{ set: row.boardId }}
      className="group flex flex-col gap-2 bg-hextech-black/30 p-4 outline outline-icon/15 -outline-offset-1 transition duration-150 hover:bg-hextech-black/50 hover:outline-gold2/50 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span
            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide outline -outline-offset-1 ${tone}`}
          >
            {AXIS_LABEL[row.boardType] ?? row.boardType}
          </span>
          <span className="font-serif text-lg font-bold text-gold1 group-hover:text-gold2">
            {row.boardTitle}
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-grey1">
          <FontAwesomeIcon icon={faUser} className="h-3 text-gold2/60" />
          {row.who}
          <span className="text-icon/40">·</span>
          <TimeAgo iso={row.at} />
          <span className="text-icon/40">·</span>
          {row.placed}/{row.total} placed
        </p>
        {row.sTier.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-bold text-[#c8423a]">S</span>
            {row.sTier.slice(0, 4).map((name) => (
              <span
                key={name}
                className="truncate bg-hextech-black/50 px-1.5 py-0.5 text-grey1 outline outline-icon/15 -outline-offset-1"
              >
                {name}
              </span>
            ))}
            {row.sTier.length > 4 && (
              <span className="text-grey1/60">+{row.sTier.length - 4}</span>
            )}
          </p>
        )}
      </div>
      <span className="hidden shrink-0 items-center gap-1.5 text-sm font-bold text-gold2 transition group-hover:text-gold1 sm:flex">
        Rank it
        <FontAwesomeIcon
          icon={faArrowRight}
          className="h-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  )
}

const FILTERS: { key?: string; label: string }[] = [
  { label: 'All' },
  { key: 'champion', label: 'Champions' },
  { key: 'line', label: 'Skin lines' },
  { key: 'year', label: 'Years' },
  { key: 'price', label: 'Prices' },
  { key: 'rarity', label: 'Rarities' },
]

function BrowsePage() {
  const { feed } = Route.useLoaderData()
  const [axis, setAxis] = useState<string | undefined>(undefined)
  const [board, setBoard] = useState<ScopeOption | null>(null)
  const [rows, setRows] = useState<TierFeedRow[]>(feed.rows)
  const [total, setTotal] = useState(feed.total)
  const [offset, setOffset] = useState(feed.rows.length)
  const [loading, setLoading] = useState(false)
  const [scopes, setScopes] = useState<TierScopeCatalog | null>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    fetchTierScopes()
      .then(setScopes)
      .catch(() => {})
  }, [])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!scopes || q.length < 1) return []
    return flattenScopes(scopes)
      .filter((s) => s.label.toLowerCase().includes(q))
      .slice(0, 8)
  }, [scopes, query])

  const load = async (opts: { axis?: string; boardId?: string }) => {
    setLoading(true)
    try {
      const res = await fetchTierFeed({ data: opts })
      setRows(res.rows)
      setTotal(res.total)
      setOffset(res.rows.length)
    } finally {
      setLoading(false)
    }
  }

  const selectAxis = (next?: string) => {
    if (loading) return
    setBoard(null)
    setQuery('')
    setAxis(next)
    void load({ axis: next })
  }

  const pickSet = (s: ScopeOption) => {
    setBoard(s)
    setAxis(undefined)
    setQuery('')
    setFocused(false)
    void load({ boardId: s.boardId })
  }

  const clearSet = () => {
    setBoard(null)
    void load({})
  }

  const loadMore = async () => {
    if (loading) return
    setLoading(true)
    try {
      const next = await fetchTierFeed({
        data: { offset, axis, boardId: board?.boardId },
      })
      setRows((prev) => [...prev, ...next.rows])
      setOffset(offset + next.rows.length)
    } finally {
      setLoading(false)
    }
  }

  const countContext = board
    ? `${board.label} tier lists`
    : axis
      ? 'in this filter'
      : 'tier lists and counting'

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <nav className="mb-5 flex items-center gap-2 text-xs font-semibold text-grey1">
        <Link to="/battle" className="transition-colors hover:text-gold1">
          Battle
        </Link>
        <span className="text-icon/40">/</span>
        <Link to="/battle/tier-drop" className="transition-colors hover:text-gold1">
          Tier Drop
        </Link>
        <span className="text-icon/40">/</span>
        <span className="text-gold2">Community</span>
      </nav>

      <header className="animate-fade-up mb-5">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <FontAwesomeIcon icon={faLayerGroup} className="mr-2 h-3.5" />
          Community Tier Lists
        </p>
        <h1 className="font-serif text-3xl font-bold text-gold1 md:text-4xl">
          What everyone's ranking
        </h1>
        <p className="mt-2 text-sm text-grey1">
          <span className="tabular-nums text-gold2">{total.toLocaleString()}</span>{' '}
          {countContext}. Newest first; tap any to rank the same set.
        </p>
      </header>

      {/* Search for a specific set (champion, line, year, …). */}
      <div className="animate-fade-up relative mb-3">
        <FontAwesomeIcon
          icon={faMagnifyingGlass}
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1/60"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Filter by a specific set: Jax, Project, 2021…"
          className="w-full bg-hextech-black/40 py-2 pl-9 pr-3 text-sm text-gold1 outline outline-icon/20 -outline-offset-1 placeholder:text-grey1/50 focus:outline-gold2/60"
        />
        {focused && suggestions.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto bg-hextech-black outline outline-icon/30 -outline-offset-1">
            {suggestions.map((s) => (
              <li key={s.boardId}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickSet(s)
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm text-gold1 transition-colors hover:bg-gold5/15"
                >
                  <span className="truncate font-semibold">{s.label}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-grey1/60">
                    {AXIS_LABEL[s.axis] ?? s.axis}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The active specific-set filter, or the broad axis chips. */}
      {board ? (
        <div className="animate-fade-up mb-5">
          <span className="inline-flex items-center gap-2 bg-gold5/25 px-3 py-1.5 text-sm font-bold text-gold1 outline outline-gold2/60 -outline-offset-1">
            {AXIS_LABEL[board.axis] ?? board.axis}: {board.label}
            <button
              onClick={clearSet}
              aria-label="Clear filter"
              className="cursor-pointer text-gold2 transition-colors hover:text-gold1"
            >
              <FontAwesomeIcon icon={faXmark} className="h-3.5" />
            </button>
          </span>
        </div>
      ) : (
        <div className="animate-fade-up mb-5 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = f.key === axis
            return (
              <button
                key={f.label}
                onClick={() => selectAxis(f.key)}
                disabled={loading}
                className={`cursor-pointer px-3 py-1.5 text-sm font-semibold outline -outline-offset-1 transition-colors duration-150 disabled:opacity-60 ${
                  active
                    ? 'bg-gold5/25 text-gold1 outline-gold2/60'
                    : 'text-grey1 outline-icon/15 hover:text-gold2'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-grey1">
          {loading ? 'Loading…' : 'No tier lists here yet.'}
        </p>
      ) : (
        <div className="stagger flex flex-col gap-2">
          {rows.map((row, i) => (
            <FeedRow
              key={`${board?.boardId ?? axis ?? 'all'}-${row.boardId}-${row.at}-${i}`}
              row={row}
            />
          ))}
        </div>
      )}

      {offset < total && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="flex cursor-pointer items-center gap-2 bg-hextech-black/50 px-5 py-2.5 text-sm font-bold text-gold2 outline outline-icon/25 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2/60 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  )
}
