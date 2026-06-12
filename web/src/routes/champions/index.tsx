import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faMagnifyingGlass,
  faTableCellsLarge,
  faTableCells,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import CatalogTabs from '~/components/CatalogTabs'
import Dropdown from '~/components/Dropdown'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'
import type { Champion } from '~/lib/types'

const sortOptions = [
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'most_skins', label: 'Most Skins' },
  { value: 'fewest_skins', label: 'Fewest Skins' },
]

type Density = 'comfortable' | 'compact'
const DENSITY_KEY = 'sb:championDensity'

export const Route = createFileRoute('/champions/')({
  loader: async () => {
    const champions = await api.champions()
    return { champions }
  },
  head: () => ({
    meta: [{ title: 'Champions · Skin Battle' }],
  }),
  pendingComponent: () => (
    <RouteSkeleton quip="Stealing baron..." variant="champions" />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load champions" message={error.message} />
  ),
  component: ChampionsPage,
})

function ChampionsPage() {
  const { champions } = Route.useLoaderData()

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('az')
  const [density, setDensity] = useState<Density>('comfortable')

  // Density preference persists across visits. Read in an effect so SSR and
  // the first client render agree.
  useEffect(() => {
    if (localStorage.getItem(DENSITY_KEY) === 'compact') setDensity('compact')
  }, [])
  const changeDensity = (d: Density) => {
    setDensity(d)
    localStorage.setItem(DENSITY_KEY, d)
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? champions.filter(
          (c) =>
            championDisplayName(c.id).toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            c.title.toLowerCase().includes(q),
        )
      : [...champions]
    switch (sortBy) {
      case 'za':
        filtered.sort((a, b) => b.id.localeCompare(a.id))
        break
      case 'most_skins':
        filtered.sort(
          (a, b) =>
            (b.skins?.length ?? 0) - (a.skins?.length ?? 0) ||
            a.id.localeCompare(b.id),
        )
        break
      case 'fewest_skins':
        filtered.sort(
          (a, b) =>
            (a.skins?.length ?? 0) - (b.skins?.length ?? 0) ||
            a.id.localeCompare(b.id),
        )
        break
      default:
        filtered.sort((a, b) => a.id.localeCompare(b.id))
    }
    return filtered
  }, [champions, query, sortBy])

  const compact = density === 'compact'
  const densityBtn = (active: boolean) =>
    `flex h-10 w-10 cursor-pointer items-center justify-center outline -outline-offset-1 transition duration-150 ${
      active
        ? 'bg-gold5/30 text-gold1 outline-gold2'
        : 'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
    }`

  return (
    <div className="container mx-auto px-6 pt-28 pb-12">
      <PageHeader
        eyebrow="The catalog"
        title="Champions"
        subtitle="Click on a champion to view and vote on their skins."
        className="mb-8"
      />

      <CatalogTabs active="champions" />

      {/* Toolbar: search / sort / density */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        {/* Full row on phones so the field never wraps mid-toolbar */}
        <div className="relative w-full sm:w-auto sm:min-w-56 sm:max-w-xs sm:flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-gold2"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter champions…"
            aria-label="Filter champions"
            className="h-10 w-full bg-hextech-black/40 pl-9 pr-3 text-sm text-gold1 placeholder-grey1 outline outline-icon/30 -outline-offset-1 hover:outline-icon"
          />
        </div>
        <div className="w-44">
          <Dropdown
            options={sortOptions}
            onSelect={setSortBy}
            label={
              sortOptions.find((o) => o.value === sortBy)?.label ?? 'Sort By'
            }
            selectedValue={sortBy}
          />
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Grid density">
          <button
            onClick={() => changeDensity('comfortable')}
            aria-label="Comfortable grid"
            aria-pressed={!compact}
            title="Comfortable grid"
            className={densityBtn(!compact)}
          >
            <FontAwesomeIcon icon={faTableCellsLarge} className="h-4" />
          </button>
          <button
            onClick={() => changeDensity('compact')}
            aria-label="Compact grid"
            aria-pressed={compact}
            title="Compact grid"
            className={densityBtn(compact)}
          >
            <FontAwesomeIcon icon={faTableCells} className="h-4" />
          </button>
        </div>
        <p className="ml-auto text-sm text-grey1 tabular-nums">
          {visible.length} of {champions.length}
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={faMagnifyingGlass}
          title={`No champions match “${query}”`}
          message="Try a different name, or clear the search to see the full roster."
          action={{ label: 'Clear search', onClick: () => setQuery('') }}
          compact
        />
      ) : (
        <ul
          className={
            compact
              ? 'stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
              : 'stagger grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
          }
        >
          {visible.map((champion) => (
            <ChampionCard
              key={champion.id}
              champion={champion}
              compact={compact}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ChampionCard({
  champion,
  compact,
}: {
  champion: Champion
  compact: boolean
}) {
  const defaultSkin =
    champion.skins.find((skin) => skin.num === 0) || champion.skins[0]
  const skinCount = champion.skins.length

  return (
    <li className="group relative overflow-hidden bg-hextech-black/30 transition duration-300 hover:shadow-glow">
      {/* Border drawn on an overlay so it stays visible over the splash art -
          the image's hover transform otherwise paints above an inset outline.
          Offset -1 keeps it flush with the edge so the image sits inside it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 outline outline-icon/25 -outline-offset-1 transition duration-300 group-hover:outline-gold2"
      />
      <Link
        to="/champions/$id"
        params={{ id: champion.id.toLowerCase() }}
        className="block cursor-pointer"
      >
        <div className="relative w-full aspect-video overflow-hidden">
          <img
            src={defaultSkin.splash_url}
            alt={`${championDisplayName(champion.id)} splash`}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {/* Bottom fade so the name is always legible over splash art */}
          <div className="absolute inset-0 bg-gradient-to-t from-hextech-black via-hextech-black/30 to-transparent" />
          {/* Skin count badge */}
          <span
            className={`absolute top-3 right-3 bg-hextech-black/70 outline outline-gold5/60 -outline-offset-1 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-gold2 ${compact ? 'hidden sm:block' : ''}`}
          >
            {skinCount} {skinCount === 1 ? 'skin' : 'skins'}
          </span>
          {/* Name + title over the art */}
          <div
            className={`absolute bottom-0 left-0 right-0 ${compact ? 'p-2.5' : 'p-4'}`}
          >
            <h2
              className={`font-serif font-bold text-gold1 transition-colors duration-150 group-hover:text-gold2 ${compact ? 'text-base leading-tight' : 'text-2xl'}`}
            >
              {championDisplayName(champion.id)}
            </h2>
            {!compact && (
              <p className="text-sm italic text-grey1">{champion.title}</p>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}
