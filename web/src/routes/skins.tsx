import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faShirt } from '@fortawesome/free-solid-svg-icons'
import SkinCard from '~/components/SkinCard'
import CatalogTabs from '~/components/CatalogTabs'
import Dropdown from '~/components/Dropdown'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { btnChip } from '~/lib/ui'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import type { AwardsResponse } from '~/lib/types'

const sortOptions = [
  { value: 'total_stars_desc', label: 'Most Stars' },
  { value: 'total_stars_asc', label: 'Least Stars' },
  { value: 'total_x_desc', label: 'Most Bans' },
  { value: 'total_x_asc', label: 'Least Bans' },
]

const ITEMS_PER_PAGE = 24

export const Route = createFileRoute('/skins')({
  // The awards endpoint is the one bulk read that includes the caller's own
  // votes, so the browse page shares it (plain /skins has no user columns).
  loader: async () => {
    const awards = await api.awards()
    return { awards }
  },
  head: () => ({
    meta: [{ title: 'Skins — Skin Battle' }],
  }),
  pendingComponent: () => <RouteSkeleton quip="Checking the loot tab..." />,
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the skins" message={error.message} />
  ),
  component: SkinsPage,
})

function SkinsPage() {
  const { awards: baseAwards } = Route.useLoaderData()
  const { isAuthenticated, getApiToken } = useAuth()

  const [awards, setAwards] = useState<AwardsResponse>(baseAwards)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('total_stars_desc')
  const [currentPage, setCurrentPage] = useState(1)
  const gridRef = useRef<HTMLDivElement>(null)

  // Enrich with the user's own votes when authenticated.
  useEffect(() => {
    let cancelled = false
    async function enrich() {
      if (!isAuthenticated) {
        setAwards(baseAwards)
        return
      }
      const token = await getApiToken()
      if (!token) return
      try {
        const data = await api.awards(token)
        if (!cancelled) setAwards(data)
      } catch {
        /* keep base data */
      }
    }
    enrich()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getApiToken, baseAwards])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? awards.allSkins.filter((s) =>
          `${displaySkinName(s.name, s.champion_id)} ${championDisplayName(s.champion_id)}`
            .toLowerCase()
            .includes(q),
        )
      : [...awards.allSkins]
    switch (sortBy) {
      case 'total_stars_desc':
        filtered.sort((a, b) => (b.total_stars || 0) - (a.total_stars || 0))
        break
      case 'total_stars_asc':
        filtered.sort((a, b) => (a.total_stars || 0) - (b.total_stars || 0))
        break
      case 'total_x_desc':
        filtered.sort((a, b) => (b.total_x || 0) - (a.total_x || 0))
        break
      case 'total_x_asc':
        filtered.sort((a, b) => (a.total_x || 0) - (b.total_x || 0))
        break
      default:
        break
    }
    return filtered
  }, [awards.allSkins, query, sortBy])

  // New filter or sort → the old page number no longer points anywhere useful.
  useEffect(() => {
    setCurrentPage(1)
  }, [sortBy, query])

  // Paging happens from buttons at the bottom of a long grid — bring the
  // start of the grid back into view so the new page is actually visible.
  const goToPage = (page: number) => {
    setCurrentPage(page)
    gridRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const totalPages = Math.ceil(visible.length / ITEMS_PER_PAGE)
  const currentSkins = visible.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  )

  return (
    <div className="container mx-auto px-6 pt-28 pb-12">
      <PageHeader
        eyebrow="The catalog"
        title="Skins"
        subtitle="Every skin in the game, ranked by the community. Search, sort, and spend your stars and bans."
        className="mb-8"
      />

      <CatalogTabs active="skins" />

      {/* Toolbar: search / sort / count */}
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
            placeholder="Filter skins or champions…"
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
        <p className="ml-auto text-sm text-grey1 tabular-nums">
          {visible.length} of {awards.allSkins.length}
        </p>
      </div>

      {visible.length === 0 ? (
        query ? (
          <EmptyState
            icon={faMagnifyingGlass}
            title={`No skins match “${query}”`}
            message="Try a different skin or champion name, or clear the search to browse everything."
            action={{ label: 'Clear search', onClick: () => setQuery('') }}
            compact
          />
        ) : (
          <EmptyState
            icon={faShirt}
            title="No skins found"
            message="The collection hasn't loaded yet — check back in a moment."
            compact
          />
        )
      ) : (
        <>
          <div
            ref={gridRef}
            className="stagger scroll-mt-28 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4"
          >
            {currentSkins.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                championId={skin.champion_id}
                initialStar={skin.user_star ?? false}
                initialX={skin.user_x ?? false}
                showChampion
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-4">
              <button
                onClick={() => goToPage(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className={btnChip}
              >
                Previous
              </button>
              <span className="text-sm text-grey1 tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => goToPage(Math.min(currentPage + 1, totalPages))}
                disabled={currentPage === totalPages}
                className={btnChip}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
