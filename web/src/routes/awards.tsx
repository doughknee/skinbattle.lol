import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faBan, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import SkinCard from '~/components/SkinCard'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { btnSecondarySm } from '~/lib/ui'
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
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
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
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

  // Hide skins that haven't actually received any stars/bans yet — ranking
  // a wall of zeroes reads as broken on a cold start.
  const topStarred = awards.topStarred.filter((s) => (s.total_stars ?? 0) > 0)
  const topXed = awards.topXed.filter((s) => (s.total_x ?? 0) > 0)

  // Most divisive: skins that collect BOTH stars and bans, ranked by how
  // evenly split the love/hate is, then by total heat.
  const divisive = [...awards.allSkins]
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
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

      {/* Hand off browsing to the dedicated skins page */}
      <section className="border-t border-icon/20 pt-12 text-center">
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-gold2 mb-3">
          Looking for the rest?
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-lg text-grey1">
          The awards only crown the extremes. Browse, search, and sort the full
          collection on the skins page.
        </p>
        <Link to="/skins" className={`group ${btnSecondarySm}`}>
          Browse all skins
          <FontAwesomeIcon
            icon={faArrowRight}
            className="h-4 transition-transform duration-150 group-hover:translate-x-1"
          />
        </Link>
      </section>
    </div>
  )
}
