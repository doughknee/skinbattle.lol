import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChartLine,
  faCrown,
  faHourglassHalf,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import ErrorState from '~/components/ErrorState'
import { fetchRankingsIndex } from '~/lib/games/serverFns'
import type { SliceLink } from '~/lib/games/types'

export const Route = createFileRoute('/rankings/')({
  loader: () => fetchRankingsIndex(),
  head: () => ({
    meta: [
      { title: 'Rankings — Skin Battle' },
      {
        name: 'description',
        content:
          'Community skin rankings, sliced every way that matters: by price tier, skin line, champion, and year.',
      },
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the rankings" message={error.message} />
  ),
  component: RankingsIndexPage,
})

function Chip({ link }: { link: SliceLink }) {
  return (
    <Link
      to="/rankings/$slice"
      params={{ slice: link.slice }}
      className="flex h-10 items-center gap-2 bg-hextech-black/40 px-4 text-sm font-bold text-gold1 outline outline-icon/30 -outline-offset-2 transition duration-150 hover:bg-gold5/30 hover:outline-gold2"
    >
      {link.label}
      <span className="font-normal text-grey1">{link.count}</span>
    </Link>
  )
}

function Section({
  title,
  sub,
  links,
}: {
  title: string
  sub: string
  links: SliceLink[]
}) {
  return (
    <section className="animate-fade-up mt-12">
      <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">{title}</h2>
      <p className="mb-4 text-sm text-grey1">{sub}</p>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Chip key={l.slice} link={l} />
        ))}
      </div>
    </section>
  )
}

function RankingsIndexPage() {
  const index = Route.useLoaderData()
  const [champFilter, setChampFilter] = useState('')

  const champions = useMemo(() => {
    const q = champFilter.trim().toLowerCase()
    if (!q) return index.champions.slice(0, 24)
    return index.champions.filter((c) => c.label.toLowerCase().includes(q))
  }, [index.champions, champFilter])

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Every slice is a link"
        title="Rankings"
        subtitle="The community ranking, sliced every way an argument needs: price tier, skin line, champion, year."
        className="mb-6"
      />

      <Link
        to="/rankings/$slice"
        params={{ slice: 'all' }}
        className="animate-fade-up inline-flex h-11 items-center bg-gold5/20 px-5 font-serif font-bold text-gold1 outline outline-gold2/60 -outline-offset-2 transition duration-150 hover:bg-gold5/40"
      >
        The full ranking →
      </Link>

      <Section
        title="By price tier"
        sub="What's the best skin your RP actually buys?"
        links={index.prices}
      />
      <Section
        title="By skin line"
        sub="Settle which line really is the best-dressed."
        links={index.lines}
      />
      <Section
        title="By year"
        sub="Which patch cycle aged best?"
        links={index.years}
      />

      <section className="animate-fade-up mt-12">
        <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">
          By champion
        </h2>
        <p className="mb-4 text-sm text-grey1">
          Every champion's wardrobe, ranked.
        </p>
        <div className="relative mb-4 max-w-sm">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1"
          />
          <input
            value={champFilter}
            onChange={(e) => setChampFilter(e.target.value)}
            placeholder="Find a champion…"
            className="h-11 w-full bg-hextech-black/40 pl-9 pr-3 text-gold1 outline outline-icon/30 -outline-offset-2 placeholder:text-grey1/60 focus:outline-gold2"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {champions.map((c) => (
            <Chip key={c.slice} link={c} />
          ))}
          {champFilter.trim() === '' && index.champions.length > 24 && (
            <span className="flex h-10 items-center px-2 text-sm text-grey1">
              …and {index.champions.length - 24} more — type to find them.
            </span>
          )}
        </div>
      </section>

      <section className="animate-fade-up mt-12">
        <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">
          More verdicts
        </h2>
        <p className="mb-4 text-sm text-grey1">
          The rest of the community record, beyond the battle ratings.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            to="/rankings/awards"
            className="group flex items-center gap-4 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
              <FontAwesomeIcon icon={faCrown} className="h-5 text-gold2" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold text-gold1 transition duration-150 group-hover:text-gold2">
                Awards
              </h3>
              <p className="text-sm text-grey1">
                Most starred, most banned — the community's superlatives.
              </p>
            </div>
          </Link>
          <Link
            to="/rankings/drought"
            className="group flex items-center gap-4 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
              <FontAwesomeIcon icon={faHourglassHalf} className="h-5 text-gold2" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold text-gold1 transition duration-150 group-hover:text-gold2">
                The Drought Index
              </h3>
              <p className="text-sm text-grey1">
                Days since every champion's last skin, ranked.
              </p>
            </div>
          </Link>
          <Link
            to="/rankings/elo"
            className="group flex items-center gap-4 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
              <FontAwesomeIcon icon={faChartLine} className="h-5 text-gold2" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold text-gold1 transition duration-150 group-hover:text-gold2">
                How the rankings work
              </h3>
              <p className="text-sm text-grey1">
                The rating system behind these lists, explained for humans.
              </p>
            </div>
          </Link>
        </div>
      </section>
    </div>
  )
}
