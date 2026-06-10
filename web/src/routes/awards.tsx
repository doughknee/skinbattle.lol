import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { faStar, faBan, faShirt } from '@fortawesome/free-solid-svg-icons'
import SkinCard from '~/components/SkinCard'
import Dropdown from '~/components/Dropdown'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { btnChip } from '~/lib/ui'
import type { AwardsResponse, Skin } from '~/lib/types'

// Shared section heading treatment, matched across awards/votes/champion pages.
function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <>
      <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold2 mb-3">
        {title}
      </h2>
      <p className="text-lg text-grey1 mb-10">{blurb}</p>
    </>
  )
}

// Top 3 on a podium (#1 center, raised) + the rest in a ranked grid.
function RankedShowcase({ skins }: { skins: Skin[] }) {
  // A podium needs all three steps — with fewer entries, a plain ranked
  // grid reads better than a lopsided one.
  if (skins.length < 3) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {skins.map((skin, i) => (
          <SkinCard
            key={skin.id}
            skin={skin}
            championId={skin.champion_id}
            initialVote={skin.user_vote ?? 0}
            initialStar={skin.user_star ?? false}
            initialX={skin.user_x ?? false}
            showChampion
            rank={i + 1}
          />
        ))}
      </div>
    )
  }
  const podium = skins.slice(0, 3)
  const rest = skins.slice(3)
  const podiumOrder = [
    'md:order-2 md:z-10 md:-translate-y-3',
    'md:order-1',
    'md:order-3',
  ]
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-end">
        {podium.map((skin, i) => (
          <div key={skin.id} className={podiumOrder[i]}>
            <SkinCard
              skin={skin}
              championId={skin.champion_id}
              initialVote={skin.user_vote ?? 0}
              initialStar={skin.user_star ?? false}
              initialX={skin.user_x ?? false}
              showChampion
              rank={i + 1}
            />
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {rest.map((skin, i) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              championId={skin.champion_id}
              initialVote={skin.user_vote ?? 0}
              initialStar={skin.user_star ?? false}
              initialX={skin.user_x ?? false}
              showChampion
              rank={i + 4}
            />
          ))}
        </div>
      )}
    </>
  )
}

const sortOptions = [
  { value: 'total_votes_desc', label: 'Most Votes' },
  { value: 'total_votes_asc', label: 'Least Votes' },
  { value: 'total_stars_desc', label: 'Most Stars' },
  { value: 'total_stars_asc', label: 'Least Stars' },
  { value: 'total_x_desc', label: 'Most X' },
  { value: 'total_x_asc', label: 'Least X' },
]

export const Route = createFileRoute('/awards')({
  loader: async () => {
    const awards = await api.awards()
    return { awards }
  },
  head: () => ({
    meta: [{ title: 'Awards — Skin Battle' }],
  }),
  pendingComponent: () => <RouteSkeleton quip="Invading enemy jungle..." />,
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the awards" message={error.message} />
  ),
  component: AwardsPage,
})

function AwardsPage() {
  const { awards: baseAwards } = Route.useLoaderData()
  const { isAuthenticated, getApiToken } = useAuth()

  const [awards, setAwards] = useState<AwardsResponse>(baseAwards)
  const [sortBy, setSortBy] = useState('total_votes_desc')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 24
  const allSkinsRef = useRef<HTMLElement>(null)

  // Hide skins that haven't actually received any stars/bans yet — ranking
  // a wall of zeroes reads as broken on a cold start.
  const topStarred = awards.topStarred.filter((s) => (s.total_stars ?? 0) > 0)
  const topXed = awards.topXed.filter((s) => (s.total_x ?? 0) > 0)
  const { allSkins } = awards

  // Most divisive: skins that collect BOTH stars and bans, ranked by how
  // evenly split the love/hate is, then by total heat.
  const divisive = [...allSkins]
    .filter((s) => (s.total_stars || 0) > 0 && (s.total_x || 0) > 0)
    .sort(
      (a, b) =>
        Math.min(b.total_stars || 0, b.total_x || 0) -
          Math.min(a.total_stars || 0, a.total_x || 0) ||
        (b.total_stars || 0) +
          (b.total_x || 0) -
          ((a.total_stars || 0) + (a.total_x || 0)),
    )
    .slice(0, 8)

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

  useEffect(() => {
    setCurrentPage(1)
  }, [sortBy])

  // Paging happens from buttons at the bottom of a long grid — bring the
  // start of the section back into view so the new page is actually visible.
  const goToPage = (page: number) => {
    setCurrentPage(page)
    allSkinsRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function getSortedSkins() {
    const sorted = [...allSkins]
    switch (sortBy) {
      case 'total_votes_desc':
        sorted.sort((a, b) => (b.total_votes || 0) - (a.total_votes || 0))
        break
      case 'total_votes_asc':
        sorted.sort((a, b) => (a.total_votes || 0) - (b.total_votes || 0))
        break
      case 'total_stars_desc':
        sorted.sort((a, b) => (b.total_stars || 0) - (a.total_stars || 0))
        break
      case 'total_stars_asc':
        sorted.sort((a, b) => (a.total_stars || 0) - (b.total_stars || 0))
        break
      case 'total_x_desc':
        sorted.sort((a, b) => (b.total_x || 0) - (a.total_x || 0))
        break
      case 'total_x_asc':
        sorted.sort((a, b) => (a.total_x || 0) - (b.total_x || 0))
        break
      default:
        break
    }
    return sorted
  }

  const sortedSkins = getSortedSkins()
  const totalPages = Math.ceil(sortedSkins.length / itemsPerPage)
  const indexOfLastSkin = currentPage * itemsPerPage
  const indexOfFirstSkin = indexOfLastSkin - itemsPerPage
  const currentSkins = sortedSkins.slice(indexOfFirstSkin, indexOfLastSkin)

  return (
    <div className="container mx-auto px-6 pt-28 pb-12">
      <PageHeader
        eyebrow="The community has spoken"
        title={
          <>
            A<span className="italic">wards</span>
          </>
        }
        subtitle={
          <span className="italic">
            These a(wards) aren’t for vision—they’re for the best (and worst)
            skins in League. The summoners have spoken.
          </span>
        }
        className="mb-20"
      />

      {/* Top 10 Starred Section */}
      <section className="scroll-mt-36 mb-24">
        <SectionHeading
          title="Top 10 Most Starred Skins"
          blurb="These skins are legendary. The most beloved, the most iconic."
        />
        {topStarred.length === 0 ? (
          <EmptyState
            icon={faStar}
            title="No stars awarded yet"
            message="Be the first to crown a favorite — every player gets 3 stars to spend on the skins they love most."
            cta={{ to: '/champions', label: 'Start Voting' }}
          />
        ) : (
          <RankedShowcase skins={topStarred} />
        )}
      </section>

      {/* Top 10 X'ed Section */}
      <section className="mb-24">
        <SectionHeading
          title="Top 10 Most Banned Skins"
          blurb="Not every skin is a masterpiece. These are the ones players love to hate."
        />
        {topXed.length === 0 ? (
          <EmptyState
            icon={faBan}
            title="No bans cast yet"
            message="No skin has earned the community's scorn so far. Spend your 3 bans on the ones that missed the mark."
            cta={{ to: '/champions', label: 'Start Voting' }}
          />
        ) : (
          <RankedShowcase skins={topXed} />
        )}
      </section>

      {/* Most Divisive Section — only once there's real disagreement */}
      {divisive.length > 0 && (
        <section className="mb-24">
          <SectionHeading
            title="Most Divisive Skins"
            blurb="Loved and hated in equal measure. These skins split the community right down the middle."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {divisive.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                championId={skin.champion_id}
                initialVote={skin.user_vote ?? 0}
                initialStar={skin.user_star ?? false}
                initialX={skin.user_x ?? false}
                showChampion
              />
            ))}
          </div>
        </section>
      )}

      {/* All Skins Section */}
      <section ref={allSkinsRef} className="scroll-mt-28">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold2 mb-3">
              All Skins
            </h2>
            <p className="text-lg text-grey1">Browse the full collection.</p>
          </div>
          <div className="w-44">
            <Dropdown
              options={sortOptions}
              onSelect={(value) => setSortBy(value)}
              label={
                sortOptions.find((option) => option.value === sortBy)?.label ||
                'Sort By'
              }
              selectedValue={sortBy}
            />
          </div>
        </div>

        {sortedSkins.length === 0 ? (
          <EmptyState
            icon={faShirt}
            title="No skins found"
            message="The collection hasn't loaded yet — check back in a moment."
            compact
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {currentSkins.map((skin) => (
                <SkinCard
                  key={skin.id}
                  skin={skin}
                  championId={skin.champion_id}
                  initialVote={skin.user_vote ?? 0}
                  initialStar={skin.user_star ?? false}
                  initialX={skin.user_x ?? false}
                  showChampion
                />
              ))}
            </div>
            <div className="mt-10 flex items-center justify-center gap-4">
              <button
                onClick={() => goToPage(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className={btnChip}
              >
                Previous
              </button>
              <span className="text-sm text-grey1 tabular-nums">
                Page {currentPage} of {Math.max(totalPages, 1)}
              </span>
              <button
                onClick={() => goToPage(Math.min(currentPage + 1, totalPages))}
                disabled={currentPage === totalPages}
                className={btnChip}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
