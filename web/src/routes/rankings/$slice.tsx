import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { fallbackToRaw, skinThumb } from '~/lib/img'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChevronDown,
  faCrown,
  faFlaskVial,
  faHourglassHalf,
  faLayerGroup,
  faMagnifyingGlass,
  faRankingStar,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import JsonLd from '~/components/JsonLd'
import ShareRanking from '~/components/ShareRanking'
import Verdict from '~/components/Verdict'
import { btnChip, btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fetchRankings, fetchRankingsIndex } from '~/lib/games/serverFns'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { breadcrumbJsonLd, itemListJsonLd } from '~/lib/games/jsonLd'
import { robotsMeta, sliceIsIndexable } from '~/lib/games/seo'
import {
  rankingStateOf,
  readSessionBattles,
  settleCta,
  unfurlAsk,
} from '~/lib/games/settle'
import { createSearcher } from '~/lib/search'
import type {
  RankingRow,
  RankingsIndex,
  RankingsState,
  SliceLink,
} from '~/lib/games/types'

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
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Rankings | SkinBattle' }] }
    const { state } = loaderData
    // Title and description are STATIC per slice - both come from the slice
    // definition, never from live counts. A SERP snippet is cached for weeks,
    // so a description that said "412 of 1,904 rated" would be advertising a
    // number the page stopped showing long before anyone clicked it.
    //
    // The catalog-wide page owns the broad query ("best League of Legends
    // skins") and says so in the one line search renders. No current #1 in
    // any title: a winner changes with the next vote, a title is cached.
    const title =
      state.slice === 'all'
        ? 'Best League of Legends Skins Ranked by Players | SkinBattle'
        : `${state.title} | SkinBattle`
    return {
      meta: [
        { title },
        { name: 'description', content: state.subtitle },
        // Keep near-empty slices out of the index until they hold real data.
        ...robotsMeta(sliceIsIndexable(state.ratedCount)),
        // The unfurl text is the verdict sentence plus the ask, not the search
        // description: a share has to make someone click, a snippet has to
        // stay stable. Same split the champion page makes.
        ...ogMeta({
          title,
          description: `${state.answer.answer} ${unfurlAsk(state.answer.confidence)}`,
          imagePath: `/og/rankings/${state.slice}`,
          path: `/rankings/${state.slice}`,
        }),
      ],
      links: [canonicalLink(`/rankings/${state.slice}`)],
    }
  },
  notFoundComponent: () => (
    <ErrorState
      title="No such slice"
      message="That ranking slice doesn't exist. The full ranking has a slice bar for every price tier, line, champion, and year."
      retry={false}
      back={{ to: '/rankings/all', label: 'The full ranking' }}
    />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load this ranking" message={error.message} />
  ),
  component: RankingSlicePage,
})

// ─── the ranking ────────────────────────────────────────────────────────────

// Pinned to a lookup rather than toLocaleDateString: this string is built on
// the server and again on the client during hydration, so an ambient locale or
// timezone would make the two disagree. Pure string math over the ISO date
// cannot drift.
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const releaseLabel = (iso: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && month ? `${month} ${m[1]}` : null
}

const n = (v: number): string => v.toLocaleString('en-US')

// A real <table>, because a ranking with evidence columns is tabular data and
// nothing else. It is entirely server-rendered - no JS runs to produce a row -
// so a crawler, a reader with scripts off, and an answer engine all read the
// same ordered list the browser paints. That is the whole point of the page.
//
// Responsive by dropping SECONDARY columns only. Rank, skin and rating are in
// every viewport: a phone that hides the ranking is not showing the ranking.
// Champion moves under the skin name below sm rather than disappearing.
function RankingTable({
  rows,
  caption,
}: {
  rows: RankingRow[]
  caption: string
}) {
  const th = 'py-2 font-normal'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs uppercase tracking-widest text-grey1/80">
          <tr className="border-b border-icon/25">
            <th scope="col" className={`${th} w-10 pr-2 text-right`}>
              #
            </th>
            <th scope="col" className={`${th} pl-3`}>
              Skin
            </th>
            <th scope="col" className={`${th} hidden pl-3 sm:table-cell`}>
              Champion
            </th>
            <th scope="col" className={`${th} pl-3 text-right`}>
              Rating
            </th>
            <th
              scope="col"
              className={`${th} hidden pl-3 text-right sm:table-cell`}
            >
              Battles
            </th>
            <th
              scope="col"
              className={`${th} hidden pl-3 text-right md:table-cell`}
            >
              RP
            </th>
            <th
              scope="col"
              className={`${th} hidden pl-3 text-right md:table-cell`}
            >
              Released
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const first = row.rank === 1
            const released = releaseLabel(row.release)
            return (
              <tr
                key={row.skinId}
                className="group border-b border-icon/10 transition duration-150 hover:bg-hextech-black/50"
              >
                <th
                  scope="row"
                  className={`py-2 pr-2 text-right font-serif font-bold tabular-nums ${
                    first ? 'text-gold2' : 'text-grey1'
                  }`}
                >
                  {first && (
                    <FontAwesomeIcon
                      icon={faCrown}
                      className="mr-1 h-3 align-baseline"
                      aria-label="Top rated"
                    />
                  )}
                  {row.rank}
                </th>
                <td className="py-2 pl-3">
                  <Link
                    to="/skins/$slug"
                    params={{ slug: row.slug }}
                    className="flex items-center gap-3"
                  >
                    <img
                      src={skinThumb(row.splashUrl, 192)}
                      data-raw={row.splashUrl}
                      onError={fallbackToRaw}
                      alt=""
                      loading={row.rank <= 10 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="aspect-video w-14 shrink-0 object-cover object-[50%_20%] outline outline-icon/15 -outline-offset-1 transition duration-150 group-hover:outline-gold2/60 sm:w-20"
                    />
                    <span className="min-w-0">
                      <span
                        className={`block truncate font-serif font-bold transition duration-150 group-hover:text-gold2 ${
                          first ? 'text-gold2' : 'text-gold1'
                        }`}
                      >
                        {row.name}
                      </span>
                      {/* Champion is its own column from sm up; below that it
                          rides under the name so it is never simply gone. */}
                      <span className="block truncate text-xs text-grey1 sm:hidden">
                        {row.championName}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="hidden truncate py-2 pl-3 text-grey1 sm:table-cell">
                  {row.championName}
                </td>
                <td className="py-2 pl-3 text-right whitespace-nowrap">
                  <span className="font-serif font-bold text-gold1">
                    {n(row.rating)}
                  </span>
                  {/* The band travels with the rating, always. It is the one
                      number that says how much the placing is worth. */}
                  <span className="text-xs text-grey1">
                    {' '}
                    ±{n(row.uncertainty)}
                  </span>
                </td>
                <td className="hidden py-2 pl-3 text-right tabular-nums text-grey1 sm:table-cell">
                  {n(row.battles)}
                </td>
                <td className="hidden py-2 pl-3 text-right tabular-nums text-grey1 md:table-cell">
                  {row.cost === null ? '—' : n(row.cost)}
                </td>
                <td className="hidden py-2 pl-3 text-right whitespace-nowrap text-grey1 md:table-cell">
                  {released ? (
                    <time dateTime={row.release ?? undefined}>{released}</time>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── what the ranking rests on ──────────────────────────────────────────────

// ISO day, not a rendered clock: the freshness a reader cares about is when the
// ratings were last rebuilt, which is a property of the data. Printing "today"
// because the page rendered today would be the exact lie this block exists to
// prevent. Null on a database that has never been refit - the cell drops out
// rather than printing a placeholder.
const isoDay = (iso: string | null): string | null =>
  iso && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toISOString().slice(0, 10)
    : null

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-grey1/80">
        {label}
      </dt>
      <dd className="mt-1 font-serif text-xl font-bold tabular-nums text-gold1">
        {children}
      </dd>
    </div>
  )
}

// Catalogued and ranked are DIFFERENT numbers, and this block exists so the
// page can never quietly merge them: a skin joins the ranking only once someone
// has battled it, so "every skin" and "the ranking" are not the same set. The
// vote count and the rebuild date are the provenance behind every rating above.
function DataSummary({ state }: { state: RankingsState }) {
  const rebuilt = isoDay(state.refitAt)
  const waiting = Math.max(0, state.totalCount - state.ratedCount)
  return (
    <section
      aria-labelledby="dataset-heading"
      className="animate-fade-up mt-6 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-1"
    >
      <h2
        id="dataset-heading"
        className="text-sm font-semibold uppercase tracking-[0.25em] text-gold2"
      >
        What this rests on
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Skins catalogued">{n(state.totalCount)}</Stat>
        <Stat label="Skins ranked">{n(state.ratedCount)}</Stat>
        {/* Sitewide, so it is only shown where the slice is the whole site.
            Per-skin battle counts cannot be summed into a slice total - each
            head-to-head increments both sides. */}
        {state.totalVotes !== null && (
          <Stat label="Votes recorded">{n(state.totalVotes)}</Stat>
        )}
        <Stat label="Median battles each">{n(state.medianBattles)}</Stat>
        {rebuilt && (
          <Stat label="Ratings rebuilt">
            <time dateTime={state.refitAt ?? undefined}>{rebuilt}</time>
          </Stat>
        )}
      </dl>
      <p className="mt-4 max-w-2xl text-sm text-grey1">
        Catalogued and ranked are different counts: a skin enters the ranking
        only once it has been through at least one battle, a head-to-head pick
        or a placement on a Tier Drop board
        {waiting > 0 ? (
          <>
            , so {n(waiting)} of the {n(state.totalCount)} here are still
            waiting for a first vote.
          </>
        ) : (
          <>
            , and all {n(state.totalCount)} here have cleared that bar.
          </>
        )}{' '}
        {/* /methodology directly: /rankings/elo 301s here (DONI-83), and an
            internal link through a redirect wastes the hop. */}
        {/* No font-semibold: globals.css routes bold body text into Cinzel,
            the display face, which mid-sentence reads as a different voice.
            Colour and the underline are enough for an inline link. */}
        <Link
          to="/methodology"
          className="text-gold2 underline underline-offset-2 transition duration-150 hover:text-gold1"
        >
          How the ratings are computed
        </Link>
      </p>
    </section>
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

// The slice bar: slice discovery folded into the ranking itself (this
// replaced the /rankings hub page - a filter ON the list beats a directory
// of links TO it). One trigger per dimension, one tray at a time; the group
// the current slice belongs to wears its label on the trigger.

type GroupKey = 'prices' | 'lines' | 'champions' | 'years'

const SLICE_GROUPS: { key: GroupKey; name: string; searchable: boolean }[] = [
  { key: 'prices', name: 'Price tier', searchable: false },
  { key: 'lines', name: 'Skin line', searchable: true },
  { key: 'champions', name: 'Champion', searchable: true },
  { key: 'years', name: 'Year', searchable: false },
]

// Long groups render a two-dozen teaser until the search narrows them.
const TRAY_CAP = 24

function SliceBar({
  index,
  current,
}: {
  index: RankingsIndex
  current: string
}) {
  const [openKey, setOpenKey] = useState<GroupKey | null>(null)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const activeKey = useMemo<GroupKey | null>(
    () =>
      SLICE_GROUPS.find((g) => index[g.key].some((l) => l.slice === current))
        ?.key ?? null,
    [index, current],
  )
  const currentLabel = activeKey
    ? index[activeKey].find((l) => l.slice === current)?.label
    : undefined

  useEffect(() => {
    if (!openKey) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenKey(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openKey])

  const close = () => {
    setOpenKey(null)
    setQuery('')
  }

  const open = SLICE_GROUPS.find((g) => g.key === openKey)
  const q = query.trim().toLowerCase()
  const searcher = useMemo(
    () => (open ? createSearcher(index[open.key], { keys: ['label'] }) : null),
    [index, open],
  )
  const links = searcher ? searcher.search(query) : []
  const capped = open ? open.searchable && !q && links.length > TRAY_CAP : false
  const shown = capped ? links.slice(0, TRAY_CAP) : links

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/rankings/$slice"
          params={{ slice: 'all' }}
          onClick={close}
          aria-current={current === 'all' ? 'page' : undefined}
          className={`flex h-10 items-center px-3.5 text-sm font-bold outline -outline-offset-1 transition duration-150 ${
            current === 'all'
              ? 'bg-gold5/40 text-gold1 outline-gold2'
              : 'bg-hextech-black/40 text-gold1 outline-icon/30 hover:bg-gold5/25 hover:outline-gold2/70'
          }`}
        >
          Full ranking
        </Link>
        {SLICE_GROUPS.map((g) => {
          const isOpen = openKey === g.key
          const isActive = activeKey === g.key
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => {
                setQuery('')
                setOpenKey(isOpen ? null : g.key)
              }}
              aria-expanded={isOpen}
              className={`flex h-10 cursor-pointer items-center gap-2 px-3.5 text-sm font-bold outline -outline-offset-1 transition duration-150 ${
                isActive
                  ? 'bg-gold5/40 text-gold1 outline-gold2'
                  : isOpen
                    ? 'bg-hextech-black/60 text-gold1 outline-gold2/70'
                    : 'bg-hextech-black/40 text-gold1 outline-icon/30 hover:bg-gold5/25 hover:outline-gold2/70'
              }`}
            >
              {isActive && currentLabel ? (
                <>
                  <span className="font-normal text-grey1">{g.name}</span>
                  <span className="max-w-36 truncate">{currentLabel}</span>
                </>
              ) : (
                g.name
              )}
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`h-3 text-gold2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
          )
        })}
      </div>

      {open && (
        <div className="animate-pop absolute inset-x-0 top-full z-30 mt-2 max-h-96 overflow-y-auto bg-hextech-black/95 p-4 shadow-2xl outline outline-gold2/30 -outline-offset-1 backdrop-blur">
          {open.searchable && (
            <div className="relative mb-3">
              <FontAwesomeIcon
                icon={faMagnifyingGlass}
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1"
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Find a ${open.name.toLowerCase()}…`}
                className="h-10 w-full bg-hextech-black/60 pl-9 pr-3 text-sm text-gold1 outline outline-icon/30 -outline-offset-1 placeholder:text-grey1/60 focus:outline-gold2"
              />
            </div>
          )}
          {shown.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {shown.map((l) => (
                <PickChip
                  key={l.slice}
                  link={l}
                  current={current}
                  onPick={close}
                />
              ))}
              {capped && (
                <span className="flex h-8 items-center px-1.5 text-xs text-grey1">
                  and {links.length - TRAY_CAP} more, type to find them
                </span>
              )}
            </div>
          ) : (
            <p className="py-2 text-sm text-grey1">
              Nothing here matches "{query.trim()}".
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

// A crawlable directory of every ranking slice, rendered server-side so search
// engines (and no-JS users) can walk the whole slice graph from descriptive
// anchor text. The interactive SliceBar up top is JS-gated - its slice links
// only exist after a click - so without this the price/line/champion/year
// slices are orphaned (sitemap-only: no internal links, no anchor signal).
// Native <details> keeps the ~200 links present in the DOM (Google crawls
// inside closed <details>) without a wall of text. The group holding the
// current slice opens by default.
function SliceDirectory({
  index,
  current,
}: {
  index: RankingsIndex
  current: string
}) {
  return (
    <nav
      aria-label="All rankings"
      className="mt-12 border-t border-icon/15 pt-6"
    >
      <h2 className="mb-3 font-serif text-lg font-bold text-gold1">
        Explore every ranking
      </h2>
      <div className="flex flex-col gap-2">
        {SLICE_GROUPS.map((g) => {
          const links = index[g.key]
          if (!links.length) return null
          const hasCurrent = links.some((l) => l.slice === current)
          return (
            <details
              key={g.key}
              open={hasCurrent}
              className="bg-hextech-black/30 px-4 py-2.5 outline outline-icon/15 -outline-offset-1"
            >
              <summary className="cursor-pointer select-none text-sm font-bold text-gold1 marker:text-gold2">
                {g.name}
                <span className="ml-1.5 font-normal text-grey1">
                  {links.length}
                </span>
              </summary>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {links.map((link) => {
                  const active = link.slice === current
                  return (
                    <li key={link.slice}>
                      <Link
                        to="/rankings/$slice"
                        params={{ slice: link.slice }}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-1 px-2 py-1 text-xs outline -outline-offset-1 transition duration-150 ${
                          active
                            ? 'bg-gold5/40 text-gold1 outline-gold2'
                            : 'text-grey1 outline-icon/20 hover:bg-gold5/20 hover:text-gold1 hover:outline-gold2/60'
                        }`}
                      >
                        {link.label}
                        {link.count > 0 && (
                          <span className="text-grey1/60">{link.count}</span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </details>
          )
        })}
      </div>
    </nav>
  )
}

// A price / line / year slice has an exact Tier Drop board (server/tierlist.ts
// resolveBoard): the same grammar with ':' for '-' at the first separator.
// Champion slices go to the scoped head-to-head instead, and the catalog-wide
// slice has no board. Below MIN_BOARD skins the board falls back to the daily,
// so the link is only offered where it can keep its promise.
const tierBoardFor = (slice: string, totalCount: number): string | null => {
  const m = /^(price|line|year)-(.+)$/.exec(slice)
  return m && totalCount >= 4 ? `${m[1]}:${m[2]}` : null
}

function RankingSlicePage() {
  const { state, index } = Route.useLoaderData()
  const posthog = usePostHog()

  // The ask follows the verdict (settle.ts): a champion slice asks for help
  // settling that champion by name; the catalog-wide list asks for help
  // shaping the rankings; every other slice asks for help with this one.
  const champion = /^champion-(.+)$/.exec(state.slice)?.[1] ?? null
  const championName = champion
    ? (state.rows[0]?.championName ??
      index.champions.find((l) => l.slice === state.slice)?.label ??
      null)
    : null
  const rankingState = rankingStateOf(state.answer.confidence)
  const ask =
    champion && championName
      ? settleCta(rankingState, championName)
      : state.slice === 'all'
        ? {
            label: 'Help shape the rankings',
            hint: 'Every battle is evidence in this list. Pick the skin you like more, and the ranking listens.',
          }
        : {
            label: 'Help shape this ranking',
            hint: 'Battles are dealt across the whole catalog; a Tier Drop board covers exactly this set in one pass.',
          }
  const tierBoard = tierBoardFor(state.slice, state.totalCount)
  // The share names the set, not the page title: "975 RP skins", not "Best
  // 975 RP skins" - the ranking decides what is best, the share just quotes it.
  const shareTitle =
    championName ??
    (state.slice === 'all'
      ? 'League of Legends skins'
      : state.title.replace(/^Best /, ''))

  useEffect(() => {
    posthog?.capture('ranking_viewed', {
      page_type: 'ranking-slice',
      slice: state.slice,
      champion,
      ranking_state: rankingState,
      rated: state.ratedCount,
      total: state.totalCount,
      session_battles: readSessionBattles(),
    })
    // Once per slice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.slice])

  const ctaClick = (cta: 'battle' | 'tier-drop') =>
    posthog?.capture('settle_cta_clicked', {
      page_type: 'ranking-slice',
      slice: state.slice,
      champion,
      ranking_state: rankingState,
      cta,
    })

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

  const fullyLoaded =
    remaining <= 0 && extra.slice === state.slice && extra.rows.length > 0

  // Crawlers see the SSR set (state.rows), in the order the table paints it,
  // so ItemList positions ARE the visible positions - nothing re-sorts on the
  // client. Capped at 50 so the markup stays lean: this is a summary of the
  // ranking, not a serialisation of the catalog.
  const listItems = state.rows.slice(0, 50).map((r) => ({
    name: `${r.name} (${r.championName})`,
    path: `/skins/${r.slug}`,
  }))
  // "Full ranking" names the page; an ItemList needs to name its subject.
  const listName =
    state.slice === 'all'
      ? 'League of Legends skins ranked by community battles'
      : state.title

  // One crumb per URL: the catalog-wide page IS the Rankings landing, so
  // its trail stops there rather than naming the same URL twice. The visible
  // breadcrumb below renders this same list.
  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Rankings', path: '/rankings/all' },
    ...(state.slice === 'all'
      ? []
      : [{ name: state.title, path: `/rankings/${state.slice}` }]),
  ]

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <JsonLd
        data={[
          breadcrumbJsonLd(trail),
          ...(listItems.length
            ? [itemListJsonLd({ name: listName, items: listItems })]
            : []),
        ]}
      />
      <header className="animate-fade-up mb-5">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm font-semibold">
          <ol className="flex flex-wrap items-center gap-2 text-grey1">
            {trail.map((crumb, i) => {
              const last = i === trail.length - 1
              return (
                <li key={crumb.path} className="flex items-center gap-2">
                  {i > 0 && (
                    <span aria-hidden className="text-icon/50">
                      /
                    </span>
                  )}
                  {last ? (
                    <span aria-current="page" className="text-gold2">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      to={crumb.path}
                      className="transition duration-150 hover:text-gold1"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Community rankings
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {state.title}
        </h1>
        <p className="mt-2 text-grey1">{state.subtitle}</p>
      </header>

      {/* The answer, before the evidence. Which branch this renders is
          answerBlock's call, never the page's: a #1 across the whole catalog
          has far more near neighbours to separate itself from than a #1 inside
          one champion's wardrobe, so provisional is the expected reading here
          for a long while yet, and it is reported as a measurement. */}
      <Verdict
        answer={state.answer}
        rated={state.ratedCount}
        total={state.totalCount}
      >
        <p className="w-full text-sm text-gold1/90">{ask.hint}</p>
        <Link
          to="/battle"
          search={champion ? { champion } : {}}
          onClick={() => ctaClick('battle')}
          className={btnPrimarySm}
        >
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          {ask.label}
        </Link>
        {tierBoard && (
          <Link
            to="/battle/tier-drop"
            search={{ set: tierBoard }}
            onClick={() => ctaClick('tier-drop')}
            className={btnSecondarySm}
          >
            <FontAwesomeIcon icon={faLayerGroup} className="h-4" />
            Rank this set in one pass
          </Link>
        )}
        <ShareRanking
          title={shareTitle}
          champion={!!championName}
          top={state.rows.map((r) => r.name)}
          state={rankingState}
          battles={state.rows[0]?.battles ?? 0}
          path={`/rankings/${state.slice}`}
          pageType="ranking-slice"
          championSlug={champion}
        />
        {/* Where the next battle would count most. Kept off the catalog-wide
            slice, whose ask is the whole catalog anyway. */}
        {state.slice !== 'all' && (
          <Link
            to="/settle"
            className="text-sm font-bold text-gold2 underline underline-offset-4 transition duration-150 hover:text-gold1"
          >
            <FontAwesomeIcon icon={faFlaskVial} className="mr-1.5 h-3.5" />
            Rankings that need you
          </Link>
        )}
      </Verdict>

      <DataSummary state={state} />

      {/* relative z-20: the entrance animations below create their own
          stacking contexts while running, and the slice tray must paint
          above them even mid-animation. */}
      <div className="animate-fade-up relative z-20 mb-6 mt-10">
        <SliceBar index={index} current={state.slice} />
      </div>

      {rows.length > 0 ? (
        <>
          <p className="animate-fade-up mb-3 text-sm text-grey1">
            {rows.length < state.ratedCount ? (
              <>
                Top {n(rows.length)} of {n(state.ratedCount)} ranked skins.
              </>
            ) : (
              <>
                All {n(state.ratedCount)} ranked{' '}
                {state.ratedCount === 1 ? 'skin' : 'skins'}, best first.
              </>
            )}
          </p>

          <div className="animate-fade-up">
            <RankingTable rows={rows} caption={`${state.title}, best first`} />
          </div>

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
                  : `Show more (${n(remaining)} to go)`}
              </button>
            </div>
          )}
          {fullyLoaded && (
            <p className="mt-6 text-center text-sm text-grey1">
              That's the whole list. Every ranked skin in this slice is above.
            </p>
          )}
        </>
      ) : (
        <EmptyState
          icon={faRankingStar}
          title="No verdicts yet"
          message={`None of the ${n(state.totalCount)} skins in this slice have fought a battle. Be the first to weigh in.`}
          cta={{ to: '/battle', label: 'Start battling' }}
        />
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link to="/rankings/drought" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faHourglassHalf} className="h-4" />
          Drought Index
        </Link>
      </div>

      <SliceDirectory index={index} current={state.slice} />
    </div>
  )
}
