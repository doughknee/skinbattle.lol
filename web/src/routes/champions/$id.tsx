import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import SkinCard from '~/components/SkinCard'
import type { Champion } from '~/lib/types'

export const Route = createFileRoute('/champions/$id')({
  loader: async ({ params }) => {
    // Base (public) champion data. User-vote columns are layered in
    // client-side once we have a Logto access token.
    const champion = await api.champion(params.id)
    return { champion }
  },
  pendingComponent: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed">
      <p className="text-3xl font-serif font-bold text-gold2">
        One-shotting the ADC...
      </p>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="container mx-auto p-4 pt-44 text-center">
      <h1 className="font-serif text-4xl font-bold text-gold2 mb-3">
        Champion not found
      </h1>
      <p className="text-grey1 mb-8">{error.message}</p>
      <Link
        to="/champions"
        className="inline-flex items-center gap-2 font-serif font-bold text-grey1 hover:text-gold1 transition duration-150"
      >
        <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
        Back to champions
      </Link>
    </div>
  ),
  component: ChampionPage,
})

function ChampionPage() {
  const { id } = Route.useParams()
  const { champion: baseChampion } = Route.useLoaderData()
  const { isAuthenticated, getApiToken } = useAuth()
  const [champion, setChampion] = useState<Champion>(baseChampion)

  // Re-fetch with the access token so the user's own votes are reflected.
  useEffect(() => {
    let cancelled = false
    async function enrich() {
      if (!isAuthenticated) {
        setChampion(baseChampion)
        return
      }
      const token = await getApiToken()
      if (!token) return
      try {
        const data = await api.champion(id, token)
        if (!cancelled) setChampion(data)
      } catch {
        /* keep base data on failure */
      }
    }
    enrich()
    return () => {
      cancelled = true
    }
  }, [id, isAuthenticated, getApiToken, baseChampion])

  const splash =
    champion.skins.find((s) => s.num === 0)?.splash_url ??
    champion.skins[0]?.splash_url

  return (
    <>
      {/* ── Champion hero ────────────────────────────────────── */}
      <section className="relative min-h-[58vh] w-full overflow-hidden">
        {splash && (
          <img
            src={splash}
            alt={`${champion.id} splash art`}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-hextech-black/95 via-hextech-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-gradientTop via-transparent to-hextech-black/40" />

        <div className="container mx-auto px-6 relative z-10 flex min-h-[58vh] flex-col justify-end pt-36 pb-12">
          <Link
            to="/champions"
            className="mb-6 inline-flex w-fit items-center gap-2 text-sm font-serif font-bold uppercase tracking-widest text-grey1 hover:text-gold1 transition duration-150"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="h-3" />
            Champions
          </Link>
          <h1 className="text-shadow-hero font-serif text-5xl md:text-7xl font-bold text-gold1">
            {champion.id}
          </h1>
          <p className="text-shadow-hero mt-2 text-xl md:text-2xl italic text-gold2">
            {champion.title}
          </p>
          {champion.lore && (
            <p className="text-shadow-hero mt-6 max-w-2xl text-grey1 line-clamp-4">
              {champion.lore}
            </p>
          )}
        </div>
      </section>

      {/* ── Skins ────────────────────────────────────────────── */}
      <section className="container mx-auto px-6 py-16">
        <h2 className="font-serif text-3xl font-bold text-gold2 mb-2">
          Skins
          <span className="ml-3 text-lg font-normal text-grey1">
            {champion.skins.length}
          </span>
        </h2>
        <p className="text-grey1 mb-10">
          Upvote, star, or ban each skin to shape the rankings.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-10">
          {champion.skins.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              championId={champion.id}
              initialVote={skin.user_vote ?? 0}
              initialStar={skin.user_star ?? false}
              initialX={skin.user_x ?? false}
            />
          ))}
        </div>
      </section>
    </>
  )
}
