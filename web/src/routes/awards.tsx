import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import SkinCard from '~/components/SkinCard'
import Dropdown from '~/components/Dropdown'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import type { AwardsResponse } from '~/lib/types'

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
  pendingComponent: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed">
      <p className="text-3xl font-serif font-bold text-gold2">
        Invading enemy jungle...
      </p>
    </div>
  ),
  errorComponent: ({ error }) => (
    <p className="text-red-500">Error: {error.message}</p>
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

  const { topStarred, topXed, allSkins } = awards

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
    <div className="container mx-auto p-4 pt-36">
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
          <p>No data yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {topStarred.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                championId={skin.champion_id}
                initialVote={skin.user_vote ?? 0}
                initialStar={skin.user_star ?? false}
                initialX={skin.user_x ?? false}
              />
            ))}
          </div>
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
          <p>No data yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {topXed.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                championId={skin.champion_id}
                initialVote={skin.user_vote ?? 0}
                initialStar={skin.user_star ?? false}
                initialX={skin.user_x ?? false}
              />
            ))}
          </div>
        )}
      </section>

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
