import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faHourglassHalf,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import ErrorState from '~/components/ErrorState'
import { btnSecondarySm } from '~/lib/ui'
import { fetchDrought } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import type { DroughtRow } from '~/lib/games/types'

export const Route = createFileRoute('/rankings/drought')({
  // Pure derived data — loads before render (SSR-complete first paint),
  // nothing personalized, nothing written.
  loader: () => fetchDrought(),
  head: () => ({
    meta: [
      { title: 'The Skin Drought Index — Skin Battle' },
      {
        name: 'description',
        content:
          'Days since every League champion’s last skin, ranked. Settle the drought argument with a link.',
      },
      ...ogMeta({
        title: 'The Skin Drought Index — Skin Battle',
        description:
          'Days since every League champion’s last skin, ranked. Settle the drought argument with a link.',
        card: 'drought',
        path: '/rankings/drought',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the Drought Index" message={error.message} />
  ),
  component: DroughtPage,
})

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex h-24 flex-col justify-center bg-hextech-black/30 px-5 outline outline-icon/20 -outline-offset-2">
      <p className="font-serif text-3xl font-bold text-gold1">{value}</p>
      <p className="text-sm text-grey1">{label}</p>
    </div>
  )
}

function DroughtRowItem({ row, maxDays }: { row: DroughtRow; maxDays: number }) {
  const pct = maxDays > 0 ? Math.max(2, Math.round((100 * row.days) / maxDays)) : 0
  return (
    <li className="flex items-center gap-4 bg-hextech-black/30 p-3 outline outline-icon/10 -outline-offset-1">
      <span className="w-9 shrink-0 text-right font-serif text-sm font-bold text-grey1">
        #{row.rank}
      </span>
      <Link
        to="/skins/$slug"
        params={{ slug: row.lastSkinSlug }}
        className="shrink-0 outline outline-icon/20 -outline-offset-1 transition duration-150 hover:outline-gold2"
        title={row.lastSkinName}
      >
        <img
          src={row.lastSkinSplashUrl}
          alt={row.lastSkinName}
          loading="lazy"
          decoding="async"
          className="aspect-video w-20 object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif font-bold text-gold1">
          {row.championName}
        </p>
        <p className="truncate text-sm text-grey1">
          last: {row.lastSkinName} · {fmtDate(row.lastSkinDate)} ·{' '}
          {row.skinCount} skins
        </p>
        <div className="mt-1.5 h-1 w-full bg-hextech-black/60">
          <div className="h-full bg-gold2/80" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-serif text-xl font-bold text-gold1">
          {row.days.toLocaleString()}
        </p>
        <p className="text-xs text-grey1">days</p>
      </div>
    </li>
  )
}

function DroughtPage() {
  const state = Route.useLoaderData()
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return state.rows
    return state.rows.filter((r) => r.championName.toLowerCase().includes(q))
  }, [state.rows, filter])

  const leader = state.rows[0]
  const maxDays = leader?.days ?? 0

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Rankings · updated daily"
        title={
          <>
            The Skin Dr<span className="italic">ought</span> Index
          </>
        }
        subtitle="Days since every champion's last skin, ranked. Settle the argument with a link."
        className="mb-10"
      />

      {leader && (
        <p className="animate-fade-up mb-8 max-w-2xl text-lg text-grey1">
          <FontAwesomeIcon icon={faHourglassHalf} className="mr-2 h-4 text-gold2" />
          Longest drought: <b className="text-gold1">{leader.championName}</b> —{' '}
          <b className="text-gold1">{leader.days.toLocaleString()} days</b> since{' '}
          {leader.lastSkinName} ({fmtDate(leader.lastSkinDate)}), and counting.
        </p>
      )}

      <section className="animate-fade-up mb-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          value={state.stats.longestDays.toLocaleString()}
          label="days, longest drought"
        />
        <Stat
          value={String(state.stats.overTwoYears)}
          label="champions waiting 2+ years"
        />
        <Stat
          value={state.stats.averageDays.toLocaleString()}
          label="days, average wait"
        />
      </section>

      <div className="animate-fade-up mb-4 flex max-w-2xl items-center gap-3">
        <div className="relative flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a champion…"
            className="h-11 w-full bg-hextech-black/40 pl-9 pr-3 text-gold1 outline outline-icon/30 -outline-offset-2 placeholder:text-grey1/60 focus:outline-gold2"
          />
        </div>
        <span className="shrink-0 text-sm text-grey1">
          {rows.length} of {state.stats.champions}
        </span>
      </div>

      <ol className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <DroughtRowItem key={r.championId} row={r} maxDays={maxDays} />
        ))}
        {rows.length === 0 && (
          <li className="flex h-16 items-center justify-center bg-hextech-black/30 text-sm text-grey1 outline outline-icon/10 -outline-offset-1">
            No champion matches "{filter.trim()}".
          </li>
        )}
      </ol>

      {state.undated.length > 0 && (
        <p className="mt-6 max-w-2xl text-sm text-grey1">
          Not yet measurable (release dates pending in the facts snapshot):{' '}
          {state.undated.map((u) => u.championName).join(', ')}.
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link to="/rankings" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          All rankings
        </Link>
        <span className="text-sm text-grey1">
          Dates from the committed skin-facts snapshot · counts exclude base skins
        </span>
      </div>
    </div>
  )
}
