import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faChevronDown,
  faCrown,
  faFlaskVial,
  faLayerGroup,
  faMagnifyingGlass,
  faRankingStar,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import { btnChip, btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fetchRankings, fetchRankingsIndex } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import type { RankingRow, RankingsIndex, SliceLink } from '~/lib/games/types'

export const Route = createFileRoute('/rankings/$slice')({
  // The slice index ships alongside the rows so the in-page picker can hop
  // between slices without a detour through /rankings.
  loader: async ({ params }) => {
    const [state, index] = await Promise.all([
      fetchRankings({ data: { slice: params.slice } }),
      fetchRankingsIndex(),
    ])
    if (!state) throw notFound()
    return { state, index }
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.state.title} — Skin Battle` },
          {
            name: 'description',
            content: `${loaderData.state.subtitle} ${loaderData.state.ratedCount} of ${loaderData.state.totalCount} rated so far.`,
          },
          ...ogMeta({
            title: `${loaderData.state.title} — Skin Battle`,
            description: loaderData.state.subtitle,
            imagePath: `/og/rankings/${loaderData.state.slice}`,
            path: `/rankings/${loaderData.state.slice}`,
          }),
        ]
      : [{ title: 'Rankings — Skin Battle' }],
  }),
  notFoundComponent: () => (
    <ErrorState
      title="No such slice"
      message="That ranking slice doesn't exist. Browse the index for every price tier, line, champion, and year."
      retry={false}
      back={{ to: '/rankings', label: 'All rankings' }}
    />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load this ranking" message={error.message} />
  ),
  component: RankingSlicePage,
})

// ─── confidence ─────────────────────────────────────────────────────────────

// "1480 ± 90 · 7 battles" reads like a spreadsheet, so rows show a
// confidence read instead; the raw numbers stay one hover away.
const CONFIDENCE = [
  { label: 'early call', tone: 'text-grey1' },
  { label: 'settling in', tone: 'text-blue2' },
  { label: 'solid', tone: 'text-gold2' },
] as const

const confidenceLevel = (battles: number) =>
  battles >= 15 ? 2 : battles >= 6 ? 1 : 0

const BAR_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5']

function ConfidenceHint({
  row,
  compact = false,
  className = '',
}: {
  row: RankingRow
  compact?: boolean
  className?: string
}) {
  const level = confidenceLevel(row.battles)
  const { label, tone } = CONFIDENCE[level]
  const battles = `${row.battles} ${row.battles === 1 ? 'battle' : 'battles'}`
  return (
    <span
      title={`Rated ${row.rating} ± ${row.uncertainty} over ${battles}`}
      className={`flex items-center gap-1.5 text-xs ${tone} ${className}`}
    >
      <span className="flex items-end gap-px" aria-hidden="true">
        {BAR_HEIGHTS.map((h, i) => (
          <i
            key={h}
            className={`block w-1 ${h} ${i <= level ? 'bg-current' : 'bg-grey2'}`}
          />
        ))}
      </span>
      {!compact && (
        <span className="whitespace-nowrap">
          {label} · {battles}
        </span>
      )}
    </span>
  )
}

// ─── rows ───────────────────────────────────────────────────────────────────

// Top 3: full splash-art cards. #1 takes the whole row at a cinematic crop;
// #2 and #3 share the next one. Splashes keep their subjects in the upper
// middle, so wide crops anchor near the top.
function PodiumCard({ row }: { row: RankingRow }) {
  const first = row.rank === 1
  return (
    <Link
      to="/skins/$slug"
      params={{ slug: row.slug }}
      className={`group relative block overflow-hidden bg-hextech-black/60 outline -outline-offset-1 transition duration-200 hover:outline-gold2 ${
        first ? 'outline-gold2/60 sm:col-span-2' : 'outline-icon/25'
      }`}
    >
      <img
        src={row.splashUrl}
        alt={row.name}
        loading={first ? 'eager' : 'lazy'}
        decoding="async"
        className={`w-full object-cover object-[50%_25%] transition duration-300 group-hover:scale-[1.02] ${
          first ? 'aspect-[16/10] sm:aspect-[21/9]' : 'aspect-[16/10] sm:aspect-video'
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-hextech-black/95 via-hextech-black/25 to-transparent" />
      <span
        className={`absolute left-3 top-3 flex items-center gap-1.5 px-2.5 py-1 font-serif text-sm font-bold outline -outline-offset-1 ${
          first
            ? 'bg-gold5/80 text-gold1 outline-gold2'
            : 'bg-hextech-black/75 text-gold1 outline-icon/40'
        }`}
      >
        {first && <FontAwesomeIcon icon={faCrown} className="h-3.5" />}#{row.rank}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p
          className={`text-shadow-hero truncate font-serif font-bold text-gold1 transition duration-150 group-hover:text-gold2 ${
            first ? 'text-2xl md:text-4xl' : 'text-xl md:text-2xl'
          }`}
        >
          {row.name}
        </p>
        <div className="mt-0.5 flex items-end justify-between gap-4">
          <p className="text-shadow-hero min-w-0 truncate text-sm text-grey1">
            {row.championName}
            {row.cost !== null && <> · {row.cost.toLocaleString()} RP</>}
          </p>
          <div className="flex shrink-0 items-center gap-2.5">
            {/* Only the full-width #1 card on a wide screen has room for
                the labeled hint; everywhere else the bars carry it. */}
            {first ? (
              <>
                <ConfidenceHint row={row} compact className="sm:hidden" />
                <ConfidenceHint row={row} className="hidden sm:flex" />
              </>
            ) : (
              <ConfidenceHint row={row} compact />
            )}
            <p
              className={`text-shadow-hero font-serif font-bold text-gold1 ${
                first ? 'text-3xl md:text-4xl' : 'text-2xl'
              }`}
            >
              {row.rating}
            </p>
          </div>
        </div>
      </div>
    </Link>
  )
}

// Ranks 4 to 10: comfortable rows with a real look at the splash.
function MidRow({ row }: { row: RankingRow }) {
  return (
    <li>
      <Link
        to="/skins/$slug"
        params={{ slug: row.slug }}
        className="group flex items-center gap-3 bg-hextech-black/30 p-2.5 outline outline-icon/15 -outline-offset-1 transition duration-150 hover:bg-hextech-black/50 hover:outline-gold2/60 sm:gap-4 sm:p-3"
      >
        <span className="w-7 shrink-0 text-center font-serif text-lg font-bold text-gold2 sm:w-9">
          {row.rank}
        </span>
        <img
          src={row.splashUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-video w-24 shrink-0 object-cover object-[50%_20%] outline outline-icon/20 -outline-offset-1 sm:w-36"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif font-bold text-gold1 transition duration-150 group-hover:text-gold2 sm:text-lg">
            {row.name}
          </p>
          <p className="truncate text-xs text-grey1 sm:text-sm">
            {row.championName}
            {row.cost !== null && <> · {row.cost.toLocaleString()} RP</>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-serif text-lg font-bold text-gold1 sm:text-xl">
            {row.rating}
          </p>
          <ConfidenceHint row={row} compact className="justify-end sm:hidden" />
          <ConfidenceHint row={row} className="hidden justify-end sm:flex" />
        </div>
      </Link>
    </li>
  )
}

// Rank 11 down: the dense tail of the table.
function CompactRow({ row }: { row: RankingRow }) {
  return (
    <li>
      <Link
        to="/skins/$slug"
        params={{ slug: row.slug }}
        className="group flex items-center gap-3 bg-hextech-black/20 px-2 py-1.5 outline outline-icon/10 -outline-offset-1 transition duration-150 hover:bg-hextech-black/50 hover:outline-gold2/50"
      >
        <span className="w-7 shrink-0 text-center font-serif text-sm font-bold text-grey1 sm:w-9">
          {row.rank}
        </span>
        <img
          src={row.splashUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-video w-16 shrink-0 object-cover object-[50%_20%] outline outline-icon/15 -outline-offset-1 sm:w-20"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gold1 transition duration-150 group-hover:text-gold2">
            {row.name}
          </p>
          <p className="truncate text-xs text-grey1">
            {row.championName}
            {row.cost !== null && <> · {row.cost.toLocaleString()} RP</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ConfidenceHint row={row} compact />
          <p className="w-10 text-right font-serif font-bold text-gold1">
            {row.rating}
          </p>
        </div>
      </Link>
    </li>
  )
}

// ─── slice picker ───────────────────────────────────────────────────────────

function PickChip({
  link,
  current,
  onPick,
}: {
  link: SliceLink
  current: string
  onPick: () => void
}) {
  const active = link.slice === current
  return (
    <Link
      to="/rankings/$slice"
      params={{ slice: link.slice }}
      onClick={onPick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 items-center gap-1.5 px-2.5 text-xs font-bold outline -outline-offset-1 transition duration-150 ${
        active
          ? 'bg-gold5/40 text-gold1 outline-gold2'
          : 'bg-hextech-black/40 text-gold1 outline-icon/25 hover:bg-gold5/25 hover:outline-gold2/70'
      }`}
    >
      {link.label}
      {link.count > 0 && (
        <span className="font-normal text-grey1">{link.count}</span>
      )}
    </Link>
  )
}

// In-page slice switching: one button, one panel, every slice reachable.
// Champions and lines are long lists, so the panel leans on its filter
// instead of rendering hundreds of chips up front.
const GROUP_CAP = 18

function SlicePicker({
  index,
  current,
}: {
  index: RankingsIndex
  current: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const q = query.trim().toLowerCase()
  const filtered = (links: SliceLink[]) =>
    q ? links.filter((l) => l.label.toLowerCase().includes(q)) : links

  const groups = [
    { name: 'Price tiers', links: filtered(index.prices), capped: false },
    { name: 'Years', links: filtered(index.years), capped: false },
    { name: 'Skin lines', links: filtered(index.lines), capped: true },
    { name: 'Champions', links: filtered(index.champions), capped: true },
  ]
  const empty = q && groups.every((g) => g.links.length === 0)

  return (
    <div ref={ref} className="relative w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2.5 bg-hextech-black/40 px-4 text-sm font-bold text-gold1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:outline-gold2 sm:w-auto"
      >
        <span className="flex items-center gap-2.5">
          <FontAwesomeIcon icon={faLayerGroup} className="h-3.5 text-gold2" />
          Switch list
        </span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`h-3 text-gold2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="animate-pop absolute right-0 z-30 mt-2 max-h-[26rem] w-[min(calc(100vw-3rem),36rem)] overflow-y-auto bg-hextech-black/95 p-4 shadow-2xl outline outline-gold2/30 -outline-offset-1 backdrop-blur">
          <div className="relative mb-3">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a champion, line, year, or tier"
              className="h-10 w-full bg-hextech-black/60 pl-9 pr-3 text-sm text-gold1 outline outline-icon/30 -outline-offset-1 placeholder:text-grey1/60 focus:outline-gold2"
            />
          </div>

          {!q && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <PickChip
                link={{ slice: 'all', label: 'All skins', count: 0 }}
                current={current}
                onPick={close}
              />
            </div>
          )}

          {groups.map(
            (g) =>
              g.links.length > 0 && (
                <div key={g.name} className="mt-3 first:mt-0">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gold2">
                    {g.name}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(g.capped && !q ? g.links.slice(0, GROUP_CAP) : g.links).map(
                      (l) => (
                        <PickChip
                          key={l.slice}
                          link={l}
                          current={current}
                          onPick={close}
                        />
                      ),
                    )}
                    {g.capped && !q && g.links.length > GROUP_CAP && (
                      <span className="flex h-8 items-center px-1.5 text-xs text-grey1">
                        and {g.links.length - GROUP_CAP} more, type to find them
                      </span>
                    )}
                  </div>
                </div>
              ),
          )}

          {empty && (
            <p className="py-2 text-sm text-grey1">
              Nothing matches "{query.trim()}". Try a champion, skin line,
              year, or RP price.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

function RankingSlicePage() {
  const { state, index } = Route.useLoaderData()

  // Pages pulled through "Show more", keyed to their slice so an in-page
  // slice switch can never splice one list's tail onto another's head.
  const [extra, setExtra] = useState<{ slice: string; rows: RankingRow[] }>({
    slice: state.slice,
    rows: [],
  })
  const [loadingMore, setLoadingMore] = useState(false)

  const rows =
    extra.slice === state.slice ? [...state.rows, ...extra.rows] : state.rows
  const remaining = state.ratedCount - rows.length
  const unrated = state.totalCount - state.ratedCount

  async function loadMore() {
    if (loadingMore || remaining <= 0) return
    setLoadingMore(true)
    try {
      const next = await fetchRankings({
        data: { slice: state.slice, offset: rows.length },
      })
      if (next) {
        // Ratings keep moving between page loads, so a skin can drift across
        // the offset boundary; dedupe by id to avoid double rows / dup keys.
        setExtra((prev) => {
          const base = prev.slice === state.slice ? prev.rows : []
          const seen = new Set([
            ...state.rows.map((r) => r.skinId),
            ...base.map((r) => r.skinId),
          ])
          return {
            slice: state.slice,
            rows: [...base, ...next.rows.filter((r) => !seen.has(r.skinId))],
          }
        })
      }
    } finally {
      setLoadingMore(false)
    }
  }

  const podium = rows.slice(0, 3)
  const field = rows.slice(3)
  const fullyLoaded =
    remaining <= 0 && extra.slice === state.slice && extra.rows.length > 0

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      {/* relative z-20: the entrance animations below create their own
          stacking contexts while running, and the picker panel must paint
          above them even mid-animation. */}
      <header className="animate-fade-up relative z-20 mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
            <Link
              to="/rankings"
              className="transition duration-150 hover:text-gold1"
            >
              Rankings
            </Link>
          </p>
          <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
            {state.title}
          </h1>
          <p className="mt-2 text-grey1">{state.subtitle}</p>
        </div>
        <SlicePicker index={index} current={state.slice} />
      </header>

      {/* With zero rated skins the empty state already tells the story. */}
      {state.calibrating && state.ratedCount > 0 && (
        <div className="animate-fade-up mb-6 bg-blue5/30 p-4 outline outline-blue3/50 -outline-offset-1">
          <p className="flex items-center gap-2 font-serif font-bold text-blue1">
            <FontAwesomeIcon icon={faFlaskVial} className="h-4 shrink-0" />
            Early rankings: still calibrating
          </p>
          <p className="mt-1.5 max-w-2xl text-sm text-blue1/85">
            {state.ratedCount.toLocaleString()} of{' '}
            {state.totalCount.toLocaleString()} skins here have fought, with a
            median of {state.medianBattles}{' '}
            {state.medianBattles === 1 ? 'battle' : 'battles'} each. Every
            Quick Battle pick sharpens this list.{' '}
            <Link
              to="/rankings/elo"
              className="font-semibold underline underline-offset-2 transition duration-150 hover:text-gold1"
            >
              How the rankings work
            </Link>
          </p>
          <div
            className="mt-3 h-1 w-full max-w-sm bg-hextech-black/60"
            title={`${state.ratedCount} of ${state.totalCount} rated`}
          >
            <div
              className="h-full bg-blue2/80"
              style={{
                width: `${Math.min(100, Math.round((100 * state.ratedCount) / Math.max(1, state.totalCount)))}%`,
              }}
            />
          </div>
        </div>
      )}

      {rows.length > 0 ? (
        <>
          <p className="animate-fade-up mb-3 text-sm text-grey1">
            {rows.length < state.ratedCount ? (
              <>
                Top {rows.length} of {state.ratedCount.toLocaleString()} rated
                skins.
              </>
            ) : (
              <>
                All {state.ratedCount.toLocaleString()} rated{' '}
                {state.ratedCount === 1 ? 'skin' : 'skins'}, best first.
              </>
            )}
            {unrated > 0 && (
              <>
                {' '}
                {unrated.toLocaleString()} more await their first battle.
              </>
            )}
          </p>

          <section className="animate-fade-up grid grid-cols-1 gap-2 sm:grid-cols-2">
            {podium.map((row) => (
              <PodiumCard key={row.skinId} row={row} />
            ))}
          </section>

          {field.length > 0 && (
            <ol className="stagger mt-2 flex flex-col gap-1.5">
              {field.map((row) =>
                row.rank <= 10 ? (
                  <MidRow key={row.skinId} row={row} />
                ) : (
                  <CompactRow key={row.skinId} row={row} />
                ),
              )}
            </ol>
          )}

          {remaining > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className={btnChip}
              >
                <FontAwesomeIcon icon={faChevronDown} className="h-3.5" />
                {loadingMore
                  ? 'Loading more skins...'
                  : `Show more (${remaining.toLocaleString()} to go)`}
              </button>
            </div>
          )}
          {fullyLoaded && (
            <p className="mt-6 text-center text-sm text-grey1">
              That's the whole list. Every rated skin in this slice is above.
            </p>
          )}
        </>
      ) : (
        <EmptyState
          icon={faRankingStar}
          title="No verdicts yet"
          message={`None of the ${state.totalCount.toLocaleString()} skins in this slice have fought a battle. Be the first to weigh in.`}
          cta={{ to: '/battle', label: 'Start battling' }}
        />
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link to="/battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Battle to sharpen this list
        </Link>
        <Link to="/rankings" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          All rankings
        </Link>
      </div>
    </div>
  )
}
