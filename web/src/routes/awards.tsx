import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { faStar, faBan } from '@fortawesome/free-solid-svg-icons'
import SkinCard from '~/components/SkinCard'
import Dropdown from '~/components/Dropdown'
import EmptyState from '~/components/EmptyState'
import { RouteSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import type { AwardsResponse, Skin } from '~/lib/types'

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
  pendingComponent: () => <RouteSkeleton quip="Invading enemy jungle..." />,
  errorComponent: ({ error }) => (
    <p className="container mx-auto px-6 pt-36 text-center text-red-400">
      Error: {error.message}
    </p>
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
    <div className="container mx-auto p-4 pt-28">
      {/* Page header */}
      <header className="mb-20 max-w-3xl">
        <h1 className="text-5xl md:text-6xl font-bold font-serif mb-3 text-gold2">
          A<span className="italic">wards</span>
        </h1>
        <p className="text-xl text-grey1 italic">
          These a(wards) aren’t for vision—they’re for the best (and worst) skins
          in League. The summoners have spoken.
        </p>
      </header>

      {/* Top 10 Starred Section */}
      <section className="scroll-mt-36 mb-36">
        <h2 className="text-4xl font-serif font-semibold mb-4 text-gold2">
          Top 10 Most Starred Skins
        </h2>
        <p className="text-lg text-grey1 mb-10">
          These skins are legendary. The most beloved, the most iconic.
        </p>
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
      <section className="mb-36">
        <h2 className="text-4xl font-serif font-semibold mb-4 text-gold2">
          Top 10 Most Banned Skins
        </h2>
        <p className="text-lg text-grey1 mb-10">
          Not every skin is a masterpiece. These are the ones players love to
          hate.
        </p>
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
        <section className="mb-36">
          <h2 className="text-4xl font-serif font-semibold mb-4 text-gold2">
            Most Divisive Skins
          </h2>
          <p className="text-lg text-grey1 mb-10">
            Loved and hated in equal measure. These skins split the community
            right down the middle.
          </p>
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
      <section>
        <div className="mb-10 flex justify-between items-center">
          <div>
            <h2 className="text-4xl font-serif font-semibold mb-4 text-gold2">
              All Skins
            </h2>
            <p className="text-lg text-grey1">Browse the full collection.</p>
          </div>
          <div>
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
          <p className="text-lg text-grey1">No skins found.</p>
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
            <div className="mt-8 flex justify-center items-center space-x-4">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="cursor-pointer bg-hextech-black/30 border-2 border-transparent outline-icon/30 outline -outline-offset-2 hover:border-icon hover:border-2 transition duration-150 font-serif text-grey1 hover:text-gold1 text-lg font-bold px-8 py-4 shadow-lg disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-lg text-grey1">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                }
                disabled={currentPage === totalPages}
                className="cursor-pointer bg-hextech-black/30 border-2 border-transparent outline-icon/30 outline -outline-offset-2 hover:border-icon hover:border-2 transition duration-150 font-serif text-grey1 hover:text-gold1 text-lg font-bold px-8 py-4 shadow-lg disabled:opacity-50"
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
