import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { fetchRankings } from '~/lib/games/serverFns'
import SkinCard from '~/components/SkinCard'
import Dropdown from '~/components/Dropdown'
import ErrorState from '~/components/ErrorState'
import { ChampionDetailSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'
import type { Champion } from '~/lib/types'

export const Route = createFileRoute('/champions/$id')({
  loader: async ({ params }) => {
    // Base (public) champion data. User-vote columns are layered in
    // client-side once we have a Logto access token.
    const champion = await api.champion(params.id)
    // Battle-Elo ranks for the wardrobe - display rule: Elo is THE rank;
    // star/ban/vote counts are badges and sorts, never a competing rank.
    // Non-fatal: the page works without the games layer; badges just hide.
    let elo: Record<string, { rank: number; rating: number }> = {}
    try {
      const r = await fetchRankings({
        data: { slice: `champion-${params.id.toLowerCase()}` },
      })
      if (r) {
        elo = Object.fromEntries(
          r.rows.map((row) => [row.skinId, { rank: row.rank, rating: row.rating }]),
        )
      }
    } catch {
      /* unrated wardrobe - no badges */
    }
    return { champion, elo }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${championDisplayName(loaderData.champion.id)} · Skin Battle`
          : 'Skin Battle',
      },
    ],
  }),
  pendingComponent: () => (
    <ChampionDetailSkeleton quip="One-shotting the ADC..." />
  ),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Champion not found"
      message={error.message}
      retry={false}
      back={{ to: '/champions', label: 'Back to champions' }}
    />
  ),
  component: ChampionPage,
})

function ChampionPage() {
  const { id } = Route.useParams()
  const { champion: baseChampion, elo } = Route.useLoaderData()
  const { isAuthenticated, getApiToken } = useAuth()
  const [champion, setChampion] = useState<Champion>(baseChampion)
  const [loreExpanded, setLoreExpanded] = useState(false)
  const [sortBy, setSortBy] = useState('release')

  const skinSortOptions = [
    { value: 'release', label: 'Release Order' },
    { value: 'rating', label: 'Battle Rating' },
    { value: 'stars', label: 'Most Starred' },
    { value: 'x', label: 'Most Banned' },
  ]

  // The rank badge is the battle-Elo rank within this wardrobe (from the
  // champion ranking slice). Skins nobody has battled yet get no badge -
  // ranking zeroes reads as broken.
  const ranks = useMemo(
    () =>
      new Map<string, number>(
        Object.entries(elo).map(([skinId, e]) => [skinId, e.rank]),
      ),
    [elo],
  )

  const sortedSkins = useMemo(() => {
    const skins = [...champion.skins]
    switch (sortBy) {
      case 'rating':
        skins.sort(
          (a, b) =>
            (elo[b.id]?.rating ?? -Infinity) - (elo[a.id]?.rating ?? -Infinity) ||
            a.num - b.num,
        )
        break
      case 'stars':
        skins.sort((a, b) => (b.total_stars || 0) - (a.total_stars || 0))
        break
      case 'x':
        skins.sort((a, b) => (b.total_x || 0) - (a.total_x || 0))
        break
      default:
        skins.sort((a, b) => a.num - b.num)
    }
    return skins
  }, [champion.skins, sortBy, elo])

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

        <div className="animate-fade-up container mx-auto px-6 relative z-10 flex min-h-[58vh] flex-col justify-end pt-28 pb-12">
          <Link
            to="/champions"
            className="mb-6 inline-flex w-fit items-center gap-2 text-sm font-serif font-bold uppercase tracking-widest text-grey1 hover:text-gold1 transition duration-150"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="h-3" />
            Champions
          </Link>
          <h1 className="text-shadow-hero font-serif text-5xl md:text-7xl font-bold text-gold1">
            {championDisplayName(champion.id)}
          </h1>
          <p className="text-shadow-hero mt-2 text-xl md:text-2xl italic text-gold2">
            {champion.title}
          </p>
          {champion.lore && (
            <div className="mt-6 max-w-2xl">
              <p
                className={`text-shadow-hero text-grey1 ${loreExpanded ? '' : 'line-clamp-4'}`}
              >
                {champion.lore}
              </p>
              {champion.lore.length > 280 && (
                <button
                  onClick={() => setLoreExpanded((e) => !e)}
                  aria-expanded={loreExpanded}
                  className="mt-2 cursor-pointer text-sm font-bold uppercase tracking-widest text-gold2 hover:text-gold1 transition duration-150"
                >
                  {loreExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Skins ────────────────────────────────────────────── */}
      <section className="container mx-auto px-6 py-16">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold2 mb-2">
              Skins
              <span className="ml-3 text-lg font-normal text-grey1">
                {champion.skins.length}
              </span>
            </h2>
            <p className="text-grey1">
              Star or ban each skin to crown the community favorites.
            </p>
          </div>
          <div className="w-44">
            <Dropdown
              options={skinSortOptions}
              onSelect={setSortBy}
              label={
                skinSortOptions.find((o) => o.value === sortBy)?.label ??
                'Sort By'
              }
              selectedValue={sortBy}
            />
          </div>
        </div>
        <div className="stagger grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10">
          {sortedSkins.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              championId={champion.id}
              initialStar={skin.user_star ?? false}
              initialX={skin.user_x ?? false}
              rank={ranks.get(skin.id)}
              rankContext="in this wardrobe by battle rating"
            />
          ))}
        </div>
      </section>
    </>
  )
}
