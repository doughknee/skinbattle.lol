import { createFileRoute, Link } from '@tanstack/react-router'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faMagnifyingGlass,
  faTableCells,
  faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { fallbackToRaw, skinThumb } from '~/lib/img'
import CatalogTabs from '~/components/CatalogTabs'
import Dropdown from '~/components/Dropdown'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'
import { skinSlug } from '~/lib/games/slug'
import { createSearcher } from '~/lib/search'

const sortOptions = [
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'champion', label: 'By Champion' },
]

type Density = 'comfortable' | 'compact'
// Shared with /champions on purpose: one catalog door, one density preference.
const DENSITY_KEY = 'sb:championDensity'

interface CatalogEntry {
  id: string
  name: string
  slug: string
  championName: string
  splashUrl: string
  num: number
}

export const Route = createFileRoute('/skins/')({
  // The champions payload already carries every champion's full skin list, so
  // both lenses of the catalog door share one API call - this lens flattens
  // what the other one groups.
  loader: async () => {
    const champions = await api.champions()
    const skins: CatalogEntry[] = champions.flatMap((champion) => {
      const championName = championDisplayName(champion.id)
      return (champion.skins ?? [])
        // num 0 is the champion's base look, not a skin you can own. The games
        // catalog excludes it, so /skins/$slug and the sitemap never carry it
        // - this lens has to agree with them.
        .filter((skin) => skin.num !== 0)
        .map((skin) => ({
          id: skin.id,
          name: skin.name,
          slug: skinSlug(skin.name, skin.id),
          championName,
          splashUrl: skin.splash_url,
          num: skin.num,
        }))
    })
    return { skins, championCount: champions.length }
  },
  head: () => ({
    meta: [
      { title: 'All Skins · Skin Battle' },
      {
        name: 'description',
        content:
          'Every League of Legends skin in one catalog. Browse the full list by name or champion, then open any skin for its rating, rank, and price.',
      },
      ...ogMeta({
        title: 'All Skins · Skin Battle',
        description:
          'Every League of Legends skin in one catalog. Browse the full list by name or champion, then open any skin for its rating, rank, and price.',
        card: 'games',
        path: '/skins',
      }),
    ],
    links: [canonicalLink('/skins')],
  }),
  pendingComponent: () => (
    <RouteSkeleton quip="Opening the wardrobe..." variant="champions" />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the catalog" message={error.message} />
  ),
  component: AllSkinsPage,
})

// ─── catalog card ────────────────────────────────────────────────────────────

function SkinCard({ skin, compact }: { skin: CatalogEntry; compact: boolean }) {
  return (
    <li className="card-sheen-host group relative aspect-video overflow-hidden bg-hextech-black/40 transition duration-300 hover:shadow-glow">
      <Link
        to="/skins/$slug"
        params={{ slug: skin.slug }}
        className="absolute inset-0 z-0 block"
      >
        <img
          src={skinThumb(skin.splashUrl, 768)}
          data-raw={skin.splashUrl}
          onError={fallbackToRaw}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-[50%_16%] transition duration-500 ease-out group-hover:scale-105 group-hover:brightness-110 group-hover:saturate-[1.06]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-hextech-black via-hextech-black/25 to-transparent"
        />
        <span aria-hidden className="card-sheen" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 outline outline-icon/25 -outline-offset-1 transition duration-300 group-hover:outline-gold2"
        />
        <span className="absolute inset-x-0 bottom-0 z-20 p-3">
          <span
            className={`text-shadow-hero block truncate font-serif font-bold text-gold1 transition-colors duration-150 group-hover:text-gold2 ${compact ? 'text-sm' : 'text-lg'}`}
          >
            {skin.name}
          </span>
          <span className="block truncate text-xs text-grey1">
            {skin.championName}
          </span>
        </span>
      </Link>
    </li>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

function AllSkinsPage() {
  const { skins, championCount } = Route.useLoaderData()

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('az')
  const [density, setDensity] = useState<Density>('comfortable')

  // Read in an effect so SSR and the first client render agree.
  useEffect(() => {
    if (localStorage.getItem(DENSITY_KEY) === 'compact') setDensity('compact')
  }, [])
  const changeDensity = (d: Density) => {
    setDensity(d)
    localStorage.setItem(DENSITY_KEY, d)
  }

  const searcher = useMemo(
    () => createSearcher(skins, { keys: ['name', 'championName'] }),
    [skins],
  )

  // Filter and sort live in component state, never in the URL: a crawler only
  // ever sees the full list, so there are no filter/sort permutations to index
  // and nothing to canonicalise away.
  const visible = useMemo(() => {
    const filtered = searcher.search(query)
    switch (sortBy) {
      case 'za':
        filtered.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'champion':
        filtered.sort(
          (a, b) =>
            a.championName.localeCompare(b.championName) || a.num - b.num,
        )
        break
      default:
        filtered.sort((a, b) => a.name.localeCompare(b.name))
    }
    return filtered
  }, [searcher, query, sortBy])

  const compact = density === 'compact'
  const densityBtn = (active: boolean) =>
    `flex h-10 w-10 cursor-pointer items-center justify-center outline -outline-offset-1 transition duration-150 ${
      active
        ? 'bg-gold5/30 text-gold1 outline-gold2'
        : 'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
    }`

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="The catalog"
        title="All Skins"
        subtitle={`Every skin in the game: ${skins.length.toLocaleString()} of them across ${championCount} champions. Open any one for its rating, rank, and price.`}
        className="mb-8"
      />

      <CatalogTabs current="/skins" />

      {/* Toolbar: search / sort / density - the same controls as the By
          Champion lens, so switching views doesn't switch idioms. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-56 sm:max-w-xs sm:flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-gold2"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skins…"
            aria-label="Filter skins"
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
          {visible.length.toLocaleString()} of {skins.length.toLocaleString()}
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={faMagnifyingGlass}
          title={`No skins match “${query}”`}
          message="Try a different name, or clear the search to see the whole catalog."
          action={{ label: 'Clear search', onClick: () => setQuery('') }}
          compact
        />
      ) : (
        <ul
          className={
            compact
              ? 'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
              : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
          }
        >
          {visible.map((skin) => (
            <SkinCard key={skin.id} skin={skin} compact={compact} />
          ))}
        </ul>
      )}
    </div>
  )
}
