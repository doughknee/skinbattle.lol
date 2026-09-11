import { createFileRoute, Link } from '@tanstack/react-router'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faMagnifyingGlass,
  faTableCells,
  faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons'
import { fallbackToRaw, skinThumb } from '~/lib/img'
import CatalogTabs from '~/components/CatalogTabs'
import Dropdown from '~/components/Dropdown'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'
import { fetchCatalog } from '~/lib/games/serverFns'
import { createSearcher } from '~/lib/search'
import type { CatalogChampionEntry } from '~/lib/games/types'

const sortOptions = [
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'most_skins', label: 'Most Skins' },
  { value: 'fewest_skins', label: 'Fewest Skins' },
]

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Reveal-on-hover, with a touch fallback (no :hover → show always).
const revealFade =
  'opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100'

type Density = 'comfortable' | 'compact'
const DENSITY_KEY = 'sb:championDensity'

export const Route = createFileRoute('/champions/')({
  // The roster and each champion's skin count come from the games catalog
  // (server/catalog.ts championRoster), the same rows the champion page
  // counts - so a card can never say 21 where the page says 20. The Go API's
  // copy counted the base look and drifted by a skin or two.
  loader: async () => {
    const { champions } = await fetchCatalog()
    return { champions }
  },
  head: () => ({
    meta: [
      { title: 'Champions | SkinBattle' },
      {
        name: 'description',
        content:
          'Every League of Legends champion and their skins, ranked by SkinBattle community battles. Pick a champion to see its best skins.',
      },
      ...ogMeta({
        title: 'Champions | SkinBattle',
        description:
          'Every League of Legends champion and their skins, ranked by SkinBattle community battles. Pick a champion to see its best skins.',
        card: 'games',
        path: '/champions',
      }),
    ],
    links: [canonicalLink('/champions')],
  }),
  pendingComponent: () => (
    <RouteSkeleton quip="Stealing baron..." variant="champions" />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load champions" message={error.message} />
  ),
  component: ChampionsPage,
})

const firstLetter = (champion: CatalogChampionEntry) =>
  championDisplayName(champion.championId).charAt(0).toUpperCase()

// ─── roster card ─────────────────────────────────────────────────────────────

function ChampionCard({
  champion,
  compact,
}: {
  champion: CatalogChampionEntry
  compact: boolean
}) {
  const name = championDisplayName(champion.championId)
  const skinCount = champion.skinCount

  return (
    <li
      id={`champ-${champion.championId}`}
      className="card-sheen-host group relative aspect-video scroll-mt-28 overflow-hidden bg-hextech-black/40 transition duration-300 hover:shadow-glow"
    >
      <Link
        to="/champions/$id"
        params={{ id: champion.championId.toLowerCase() }}
        aria-label={`${name} wardrobe`}
        className="absolute inset-0 z-0 block"
      >
        <img
          src={skinThumb(champion.splashUrl, 768)}
          data-raw={champion.splashUrl}
          onError={fallbackToRaw}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-[50%_16%] transition duration-500 ease-out group-hover:scale-105 group-hover:brightness-110 group-hover:saturate-[1.06]"
        />
      </Link>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-hextech-black via-hextech-black/25 to-transparent"
      />
      <span aria-hidden className="card-sheen" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 outline outline-icon/25 -outline-offset-1 transition duration-300 group-hover:outline-gold2"
      />
      {/* Skin count earns its keep on hover; the resting card is just art + name. */}
      <span
        className={`pointer-events-none absolute right-2 top-2 z-20 bg-hextech-black/80 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold2 outline outline-gold5/60 -outline-offset-1 backdrop-blur-sm ${revealFade}`}
      >
        {skinCount} {skinCount === 1 ? 'skin' : 'skins'}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3">
        <h3
          className={`text-shadow-hero truncate font-serif font-bold text-gold1 transition-colors duration-150 group-hover:text-gold2 ${compact ? 'text-sm' : 'text-lg'}`}
        >
          {name}
        </h3>
      </div>
    </li>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

function ChampionsPage() {
  const { champions } = Route.useLoaderData()

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('az')
  const [density, setDensity] = useState<Density>('comfortable')
  const [hoveredLetter, setHoveredLetter] = useState<number | null>(null)

  // Density preference persists across visits. Read in an effect so SSR and
  // the first client render agree.
  useEffect(() => {
    if (localStorage.getItem(DENSITY_KEY) === 'compact') setDensity('compact')
  }, [])
  const changeDensity = (d: Density) => {
    setDensity(d)
    localStorage.setItem(DENSITY_KEY, d)
  }

  const totalSkins = useMemo(
    () => champions.reduce((n, c) => n + c.skinCount, 0),
    [champions],
  )

  // Index the display name (a derived value) and the id.
  const searcher = useMemo(
    () =>
      createSearcher(
        champions.map((c) => ({
          c,
          name: championDisplayName(c.championId),
          id: c.championId,
        })),
        { keys: ['name', 'id'] },
      ),
    [champions],
  )

  const visible = useMemo(() => {
    const filtered = searcher.search(query).map((r) => r.c)
    const byId = (a: CatalogChampionEntry, b: CatalogChampionEntry) =>
      a.championId.localeCompare(b.championId)
    switch (sortBy) {
      case 'za':
        filtered.sort((a, b) => byId(b, a))
        break
      case 'most_skins':
        filtered.sort((a, b) => b.skinCount - a.skinCount || byId(a, b))
        break
      case 'fewest_skins':
        filtered.sort((a, b) => a.skinCount - b.skinCount || byId(a, b))
        break
      default:
        filtered.sort(byId)
    }
    return filtered
  }, [searcher, query, sortBy])

  // First champion per letter in the current order - the jump-rail targets.
  // Only meaningful while the roster is alphabetical.
  const alphabetical = sortBy === 'az' || sortBy === 'za'
  const letterTarget = useMemo(() => {
    const map = new Map<string, string>()
    if (!alphabetical) return map
    for (const c of visible) {
      const l = firstLetter(c)
      if (!map.has(l)) map.set(l, c.championId)
    }
    return map
  }, [visible, alphabetical])

  const jumpTo = (id: string) => {
    document
      .getElementById(`champ-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
        title="Champions"
        subtitle={`Browse all ${champions.length} League of Legends champions and see how their skins rank in SkinBattle community battles: ${totalSkins.toLocaleString()} skins, not counting base looks.`}
        className="mb-8"
      />

      <CatalogTabs current="/champions" />

      {/* Toolbar: search / sort / density */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
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

      {/* Roster: the A–Z index is bound to the left of the grid. It starts at
          the first card, sticks while you scroll the grid, then scrolls away
          with it (so it never rides over the footer). Cards take the rest. */}
      <div className="flex items-start gap-5">
        {alphabetical && visible.length > 0 && (
          <nav
            aria-label="Jump to letter"
            onMouseLeave={() => setHoveredLetter(null)}
            className="sticky top-24 hidden shrink-0 flex-col items-center xl:flex"
          >
            {ALPHABET.map((letter, i) => {
              const target = letterTarget.get(letter)
              const d = hoveredLetter == null ? 99 : Math.abs(i - hoveredLetter)
              const scale =
                d === 0
                  ? 2.3
                  : d === 1
                    ? 1.75
                    : d === 2
                      ? 1.4
                      : d === 3
                        ? 1.18
                        : d === 4
                          ? 1.06
                          : 1
              return (
                <button
                  key={letter}
                  type="button"
                  aria-disabled={!target}
                  onMouseEnter={() => setHoveredLetter(i)}
                  onClick={() => target && jumpTo(target)}
                  aria-label={`Jump to ${letter}`}
                  style={{ transform: `scale(${scale})` }}
                  className={`flex h-6 w-6 items-center justify-center font-serif text-xs font-bold leading-none transition-transform duration-150 ${
                    target
                      ? 'cursor-pointer text-gold2 hover:text-gold1'
                      : 'cursor-default text-grey2/60'
                  }`}
                >
                  {letter}
                </button>
              )
            })}
          </nav>
        )}

        <div className="min-w-0 flex-1">
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
                  ? 'stagger grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                  : 'stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
              }
            >
              {visible.map((champion) => (
                <ChampionCard
                  key={champion.championId}
                  champion={champion}
                  compact={compact}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
