import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faMagnifyingGlass,
  faSort,
  faSortDown,
  faSortUp,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import JsonLd from '~/components/JsonLd'
import { btnSecondarySm } from '~/lib/ui'
import { fetchDrought } from '~/lib/games/serverFns'
import { fallbackToRaw, skinThumb } from '~/lib/img'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { breadcrumbJsonLd, datasetJsonLd } from '~/lib/games/jsonLd'
import { createSearcher } from '~/lib/search'
import type { DroughtRow, DroughtState } from '~/lib/games/types'

// The Skin Drought Index: days since every champion's last skin, ranked.
//
// It is the site's most citable page, because it answers a question nothing
// else answers well - and because it needs no community data at all. Every
// number is derived from the committed League Wiki release dates and the live
// catalog, so it was quotable on day one and stays correct without a vote.
//
// Two rules keep it citable. Elapsed days are derived at QUERY time from the
// release date (server/insights.ts) - no stored counter to go stale, no daily
// job that can miss a run and publish yesterday's figure. And the page says
// out loud where the data came from and when, because a number a journalist
// cannot date and attribute is a number they cannot use.

export const Route = createFileRoute('/rankings/drought')({
  // Pure derived data - loads before render (SSR-complete first paint),
  // nothing personalized, nothing written.
  loader: () => fetchDrought(),
  head: ({ loaderData }) => {
    // Named and dated from the live leader, so the snippet is this page's own
    // rather than boilerplate - and so a stale SERP entry is visibly stale.
    const leader = loaderData?.rows[0]
    const description = leader
      ? `${leader.championName} has waited longest: ${leader.days.toLocaleString('en-US')} days since ${leader.lastSkinName}. Days since every League champion's last skin, ranked.`
      : 'Days since every League champion’s last skin, ranked. Settle the drought argument with a link.'
    const title = 'The Skin Drought Index | SkinBattle'
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        ...ogMeta({
          title,
          description,
          card: 'drought',
          path: '/rankings/drought',
        }),
      ],
      links: [canonicalLink('/rankings/drought')],
    }
  },
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the Drought Index" message={error.message} />
  ),
  component: DroughtPage,
})

// ─── formatting ─────────────────────────────────────────────────────────────

const n = (v: number) => v.toLocaleString('en-US')

// Parsed and printed as UTC: a date-only release must name the same day in
// every timezone, and must not shift between the server render and the client.
const fmtDate = (iso: string, month: 'short' | 'long' = 'short') =>
  new Date(iso.length > 10 ? iso : `${iso}T00:00:00Z`).toLocaleDateString(
    'en-US',
    { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  )

const years = (days: number) => (days / 365.25).toFixed(1)

// ─── the table ──────────────────────────────────────────────────────────────

// A real <table>, because "champion, days, last skin, date" is tabular data
// and nothing else. Server-rendered in rank order, so a crawler, a reader with
// scripts off and an answer engine all get the same ordered list the browser
// paints; sorting only re-orders what is already there.
type SortKey = 'days' | 'champion' | 'skins' | 'released'

const VALUE: Record<SortKey, (r: DroughtRow) => string | number> = {
  days: (r) => r.days,
  champion: (r) => r.championName,
  skins: (r) => r.skinCount,
  released: (r) => r.lastSkinDate,
}

// Where each column starts when you first click it: longest drought, biggest
// wardrobe and most recent skin first; champions A→Z.
const FIRST_DIR: Record<SortKey, 1 | -1> = {
  days: -1,
  champion: 1,
  skins: -1,
  released: -1,
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'champion', label: 'Champion', className: 'text-left' },
  { key: 'days', label: 'Days waiting', className: 'text-right' },
  { key: 'released', label: 'Last skin', className: 'text-left' },
  {
    key: 'skins',
    label: 'Skins',
    className: 'text-right hidden sm:table-cell',
  },
]

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number]
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (key: SortKey) => void
}) {
  const active = sort.key === column.key
  return (
    <th
      scope="col"
      className={`py-2 font-normal ${column.className}`}
      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`cursor-pointer transition duration-150 hover:text-gold1 ${
          active ? 'text-gold2' : ''
        }`}
      >
        {column.label}
        <FontAwesomeIcon
          icon={!active ? faSort : sort.dir === 1 ? faSortUp : faSortDown}
          className={`ml-1.5 h-3 ${active ? '' : 'opacity-40'}`}
        />
      </button>
    </th>
  )
}

function DroughtTable({
  rows,
  sort,
  onSort,
}: {
  rows: DroughtRow[]
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (key: SortKey) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Days since each champion's last skin, longest wait first
        </caption>
        <thead className="border-b border-icon/25 text-xs uppercase tracking-widest text-grey1">
          <tr>
            {/* The drought rank is an identity, not a row position: it stays
                with the champion when another column does the sorting. */}
            <th scope="col" className="w-10 py-2 text-right font-normal">
              #
            </th>
            <th scope="col" className="w-14 py-2 font-normal">
              <span className="sr-only">Last skin art</span>
            </th>
            {COLUMNS.map((column) => (
              <SortHeader
                key={column.key}
                column={column}
                sort={sort}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.championId}
              className="border-b border-icon/10 transition duration-150 hover:bg-hextech-black/40"
            >
              <td className="py-2 text-right font-serif text-sm tabular-nums text-grey1">
                {r.rank}
              </td>
              <td className="py-2">
                <Link
                  to="/skins/$slug"
                  params={{ slug: r.lastSkinSlug }}
                  tabIndex={-1}
                  aria-hidden
                  className="block w-14 shrink-0 outline outline-icon/20 -outline-offset-1 transition duration-150 hover:outline-gold2"
                >
                  <img
                    src={skinThumb(r.lastSkinSplashUrl, 192)}
                    data-raw={r.lastSkinSplashUrl}
                    onError={fallbackToRaw}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full object-cover"
                  />
                </Link>
              </td>
              <td className="py-2 pr-3">
                <Link
                  to="/champions/$id"
                  params={{ id: r.championId.toLowerCase() }}
                  className="font-serif font-bold text-gold1 transition duration-150 hover:text-gold2"
                >
                  {r.championName}
                </Link>
              </td>
              <td className="py-2 text-right tabular-nums text-gold1">
                {n(r.days)}
                <span className="hidden text-xs text-grey1 sm:inline">
                  {' '}
                  · {years(r.days)}y
                </span>
              </td>
              <td className="py-2 pl-3">
                <Link
                  to="/skins/$slug"
                  params={{ slug: r.lastSkinSlug }}
                  className="text-grey1 transition duration-150 hover:text-gold1"
                >
                  {r.lastSkinName}
                </Link>
                <span className="block text-xs text-grey1/80">
                  <time dateTime={r.lastSkinDate}>
                    {fmtDate(r.lastSkinDate)}
                  </time>
                </span>
              </td>
              <td className="hidden py-2 text-right tabular-nums text-grey1 sm:table-cell">
                {r.skinCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── provenance ─────────────────────────────────────────────────────────────

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-grey1">{label}</dt>
      <dd className="mt-1 font-serif text-lg font-bold text-gold1">
        {children}
      </dd>
    </div>
  )
}

// Who made this number, out of what, and when. A journalist or an answer
// engine that cannot attribute a figure cannot use it - and the distinction
// matters in both directions here: Riot owns the game data, the derivation is
// ours, and neither implies the other endorses anything.
function SourceBlock({ state }: { state: DroughtState }) {
  return (
    <section
      aria-labelledby="source-heading"
      className="animate-fade-up mt-10 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-1"
    >
      <h2
        id="source-heading"
        className="text-sm font-semibold uppercase tracking-[0.25em] text-gold2"
      >
        What this rests on
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Champions measured">{n(state.stats.champions)}</Stat>
        <Stat label="Longest drought">{n(state.stats.longestDays)} days</Stat>
        <Stat label="Average wait">{n(state.stats.averageDays)} days</Stat>
        <Stat label="Waiting 2+ years">{n(state.stats.overTwoYears)}</Stat>
        <Stat label="Counted as of">
          <time dateTime={state.date}>{fmtDate(state.date)}</time>
        </Stat>
      </dl>
      <p className="mt-4 max-w-2xl text-sm text-grey1">
        Release dates come from the committed League Wiki SkinData snapshot,
        taken at patch {state.patch} on{' '}
        <time dateTime={state.snapshotAt}>
          {fmtDate(state.snapshotAt, 'long')}
        </time>
        ; champions and skins come from Riot's own catalog. Riot Games owns the
        game data and does not endorse this site. The index itself - the elapsed
        days, the ranking, the averages - is SkinBattle's, recomputed on every
        request from that day's date rather than read off a stored counter.
        Skin counts exclude each champion's base look, the same way{' '}
        <Link
          to="/skins"
          className="text-gold2 underline underline-offset-2 transition duration-150 hover:text-gold1"
        >
          the catalog
        </Link>{' '}
        and the champion pages count.{' '}
        <Link
          to="/methodology"
          className="text-gold2 underline underline-offset-2 transition duration-150 hover:text-gold1"
        >
          How SkinBattle's data is built
        </Link>
        .
      </p>
      <p className="mt-3 max-w-2xl text-sm text-grey1">
        Cite as: SkinBattle, “The Skin Drought Index”,{' '}
        <span className="text-gold2">skinbattle.lol/rankings/drought</span>,
        retrieved <time dateTime={state.date}>{fmtDate(state.date)}</time>.
      </p>
    </section>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

function DroughtPage() {
  const state = Route.useLoaderData()
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'days',
    dir: -1,
  })

  const searcher = useMemo(
    () => createSearcher(state.rows, { keys: ['championName'] }),
    [state.rows],
  )

  const rows = useMemo(() => {
    const found = searcher.search(filter)
    const read = VALUE[sort.key]
    return [...found].sort((a, b) => {
      const x = read(a)
      const y = read(b)
      // Champion name breaks every tie, so the order is total and the same
      // list renders identically on the server and after hydration.
      return (
        (x < y ? -1 : x > y ? 1 : 0) * sort.dir ||
        a.championName.localeCompare(b.championName)
      )
    })
  }, [searcher, filter, sort])

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: FIRST_DIR[key] },
    )

  const leader = state.rows[0]

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Rankings', path: '/rankings/all' },
            { name: 'The Skin Drought Index', path: '/rankings/drought' },
          ]),
          datasetJsonLd({
            name: 'The Skin Drought Index',
            description:
              "Days since each League of Legends champion's most recent skin release, ranked longest first.",
            path: '/rankings/drought',
            dateModified: state.date,
            basedOn: [
              `League of Legends Wiki SkinData snapshot (patch ${state.patch})`,
              'Riot Games champion and skin catalog',
            ],
          }),
        ]}
      />

      <header className="animate-fade-up mb-8">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm font-semibold">
          <ol className="flex flex-wrap items-center gap-2 text-grey1">
            <li>
              <Link to="/" className="transition duration-150 hover:text-gold1">
                Home
              </Link>
            </li>
            <li aria-hidden className="text-icon/50">
              /
            </li>
            <li>
              <Link
                to="/rankings/$slice"
                params={{ slice: 'all' }}
                className="transition duration-150 hover:text-gold1"
              >
                Rankings
              </Link>
            </li>
            <li aria-hidden className="text-icon/50">
              /
            </li>
            <li aria-current="page" className="text-gold2">
              The Skin Drought Index
            </li>
          </ol>
        </nav>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          The Skin Drought Index
        </h1>
        <p className="mt-2 text-grey1">
          Days since every champion's last skin, ranked. Settle the argument
          with a link.
        </p>
      </header>

      {/* The direct answer, before the table. Which champion, how long, since
          what, and when - the four things the question actually asks. */}
      {leader && (
        <section
          aria-labelledby="answer-heading"
          className="animate-fade-up bg-gold5/20 p-6 outline -outline-offset-2 outline-gold2/50 md:p-8"
        >
          <h2
            id="answer-heading"
            className="text-sm font-semibold uppercase tracking-[0.25em] text-gold2"
          >
            The answer
          </h2>
          <p className="mt-4 text-xl leading-relaxed text-gold1 md:text-2xl">
            <Link
              to="/champions/$id"
              params={{ id: leader.championId.toLowerCase() }}
              className="underline underline-offset-4 transition duration-150 hover:text-gold2"
            >
              {leader.championName}
            </Link>{' '}
            has waited longest: {n(leader.days)} days — about{' '}
            {years(leader.days)} years — since{' '}
            <Link
              to="/skins/$slug"
              params={{ slug: leader.lastSkinSlug }}
              className="underline underline-offset-4 transition duration-150 hover:text-gold2"
            >
              {leader.lastSkinName}
            </Link>{' '}
            landed on{' '}
            <time dateTime={leader.lastSkinDate}>
              {fmtDate(leader.lastSkinDate, 'long')}
            </time>
            .
          </p>
          <p className="mt-3 max-w-2xl text-grey1">
            Measured across {n(state.stats.champions)} champions as of{' '}
            <time dateTime={state.date}>{fmtDate(state.date, 'long')}</time>.{' '}
            {n(state.stats.overTwoYears)} of them have now waited two years or
            more; the average wait is {n(state.stats.averageDays)} days.
          </p>
        </section>
      )}

      <div className="animate-fade-up mb-4 mt-10 flex max-w-2xl items-center gap-3">
        <div className="relative flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a champion…"
            aria-label="Find a champion"
            className="h-11 w-full bg-hextech-black/40 pl-9 pr-3 text-gold1 outline outline-icon/30 -outline-offset-2 placeholder:text-grey1/60 focus:outline-gold2"
          />
        </div>
        <span className="shrink-0 text-sm text-grey1">
          {rows.length} of {state.stats.champions}
        </span>
      </div>

      <div className="animate-fade-up">
        {rows.length > 0 ? (
          <DroughtTable rows={rows} sort={sort} onSort={onSort} />
        ) : (
          <p className="flex h-16 items-center justify-center bg-hextech-black/30 text-sm text-grey1 outline outline-icon/10 -outline-offset-1">
            No champion matches "{filter.trim()}".
          </p>
        )}
      </div>

      {state.undated.length > 0 && (
        <p className="mt-6 max-w-2xl text-sm text-grey1">
          Not yet measurable, because the facts snapshot has no release date for
          any of their skins:{' '}
          {state.undated.map((u) => u.championName).join(', ')}. They are left
          out of the ranking and the averages rather than counted as zero.
        </p>
      )}

      <SourceBlock state={state} />

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link
          to="/rankings/$slice"
          params={{ slice: 'all' }}
          className={btnSecondarySm}
        >
          Full ranking
        </Link>
      </div>
    </div>
  )
}
