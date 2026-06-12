import { createFileRoute, Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faBan, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import SkinCard from '~/components/SkinCard'
import EmptyState from '~/components/EmptyState'
import { HomeSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { SITE_SECTIONS } from '~/lib/siteMap'
import { btnPrimary, btnSecondary } from '~/lib/ui'
import type { Skin } from '~/lib/types'

// A guaranteed-valid base splash used if the API/leaderboard has nothing yet.
const FALLBACK_SPLASH =
  'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Jhin_0.jpg'

export const Route = createFileRoute('/')({
  loader: async () => {
    // Home is marketing-first: show real scale + live "most loved" skins.
    // Degrade gracefully if the API is unavailable so the page always renders.
    try {
      const [champions, awards] = await Promise.all([
        api.champions(),
        api.awards(),
      ])
      const skinCount = champions.reduce((n, c) => n + (c.skins?.length ?? 0), 0)
      // Only feature skins that actually have stars — on a cold start the
      // "top starred" list is just arbitrary skins with zero votes.
      const starred = awards.topStarred.filter((s) => (s.total_stars ?? 0) > 0)
      return {
        championCount: champions.length,
        skinCount,
        featured: starred[0] ?? null,
        trending: starred.slice(0, 4),
      }
    } catch {
      return { championCount: 170, skinCount: 0, featured: null, trending: [] }
    }
  },
  pendingComponent: HomeSkeleton,
  component: HomePage,
})

const steps: { icon: IconDefinition; title: string; blurb: string }[] = [
  {
    icon: faStar,
    title: 'Star (×10)',
    blurb: 'Crown your all-time favorites. You only get ten.',
  },
  {
    icon: faBan,
    title: 'Ban (×10)',
    blurb: 'Mark the ones that missed the mark. Ten bans, choose wisely.',
  },
]

// The Battle door's pages (dailies + leaderboards), straight from the site
// map so the home page never drifts from what's actually live.
const gamePages = SITE_SECTIONS.find((s) => s.to === '/battle')?.children ?? []

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

function HomePage() {
  const { championCount, skinCount, featured, trending } = Route.useLoaderData()
  const heroSplash = featured?.splash_url ?? FALLBACK_SPLASH
  const heroName = featured?.name ?? 'Jhin'

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative min-h-[92vh] w-full overflow-hidden">
        {/* Splash backdrop (sits behind the transparent, blurred navbar) */}
        <img
          src={heroSplash}
          alt={`${heroName} splash art`}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
        {/* Legibility + blend overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-hextech-black/95 via-hextech-black/65 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-gradientTop via-transparent to-hextech-black/40" />

        <div className="container mx-auto px-6 relative z-10 flex min-h-[92vh] flex-col justify-center pt-24 pb-20">
          <div className="max-w-2xl">
            <p className="animate-fade-up mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
              Community Skin Rankings
            </p>
            <h1
              className="animate-fade-up text-shadow-hero font-serif text-5xl md:text-7xl font-bold leading-[1.05] text-gold1"
              style={{ animationDelay: '100ms' }}
            >
              Settle the skin debate.
            </h1>
            <p
              className="animate-fade-up text-shadow-hero mt-6 max-w-xl text-lg md:text-xl text-grey1"
              style={{ animationDelay: '200ms' }}
            >
              Stop scrolling endless Reddit threads. Battle, star, and ban your
              way to a definitive, community-built ranking of every League skin.
            </p>

            <div
              className="animate-fade-up mt-10 flex flex-col sm:flex-row gap-4"
              style={{ animationDelay: '300ms' }}
            >
              <Link to="/battle" className={`group ${btnPrimary}`}>
                Battle Now
                <FontAwesomeIcon
                  icon={faArrowRight}
                  className="h-4 transition-transform duration-150 group-hover:translate-x-1"
                />
              </Link>
              <Link to="/rankings" className={btnSecondary}>
                See the Rankings
              </Link>
            </div>

            {/* Stat strip */}
            <div
              className="animate-fade-up mt-14 flex flex-wrap gap-x-12 gap-y-6"
              style={{ animationDelay: '400ms' }}
            >
              <Stat value={formatCount(championCount)} label="Champions" />
              {skinCount > 0 && (
                <Stat value={formatCount(skinCount)} label="Skins to rank" />
              )}
              <Stat value="Battle · Star · Ban" label="Cast your verdict" />
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="container mx-auto px-6 py-24">
        <SectionHeading
          title="How It Works"
          subtitle="Two ways to weigh in. Battles decide the rankings; stars and bans crown the superlatives."
        />
        <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s) => (
            <div
              key={s.title}
              className="bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-8 text-center transition duration-150 hover:outline-icon"
            >
              <FontAwesomeIcon icon={s.icon} className="h-9 w-9 text-gold2 mb-4" />
              <h3 className="font-serif text-xl font-bold text-gold1 mb-2">
                {s.title}
              </h3>
              <p className="text-grey1">{s.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Most loved right now (live) ──────────────────────── */}
      <section className="container mx-auto px-6 py-12">
        <div className="flex items-end justify-between gap-4 mb-10">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold2">
              Most Loved Right Now
            </h2>
            <p className="mt-2 text-lg text-grey1">
              The skins the community is starring the most.
            </p>
          </div>
          <Link
            to="/rankings/awards"
            className="hidden sm:inline-flex items-center gap-2 font-serif font-bold text-grey1 hover:text-gold1 transition duration-150 whitespace-nowrap"
          >
            View all awards
            <FontAwesomeIcon icon={faArrowRight} className="h-4" />
          </Link>
        </div>
        {trending.length === 0 ? (
          <EmptyState
            icon={faStar}
            title="No stars awarded yet"
            message="The throne is empty — be the first to crown a favorite. Every player gets 10 stars to spend."
            cta={{ to: '/champions', label: 'Start Voting' }}
            compact
          />
        ) : (
          <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {trending.map((skin: Skin) => (
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
        )}
      </section>

      {/* ── Games & leaderboards (live) ──────────────────────── */}
      <section className="container mx-auto px-6 py-24">
        <SectionHeading
          title="Daily Games & Leaderboards"
          subtitle="Rankings are just the start. Prove your skin knowledge in daily challenges, then climb the leaderboards."
        />
        <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {gamePages.map((g) => (
            <Link
              key={g.to}
              to={g.to}
              className="group bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-8 transition duration-150 hover:outline-icon"
            >
              <FontAwesomeIcon icon={g.icon} className="h-9 w-9 text-gold2 mb-4" />
              <h3 className="font-serif text-xl font-bold text-gold1 mb-2 transition duration-150 group-hover:text-gold2">
                {g.label}
              </h3>
              <p className="text-grey1">{g.blurb}</p>
            </Link>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link to="/battle" className={`group ${btnSecondary}`}>
            Enter the battle
            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-4 transition-transform duration-150 group-hover:translate-x-1"
            />
          </Link>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="container mx-auto px-6 pb-32 pt-8">
        <div className="relative overflow-hidden border-t-2 border-t-gold5 outline outline-icon/20 -outline-offset-2 bg-hextech-black/40 px-8 py-16 text-center">
          <h2 className="font-serif text-3xl md:text-5xl font-bold text-gold2 mb-4">
            Ready to crown the best?
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-grey1 mb-8">
            Jump in and start ranking. Every battle shapes the definitive list
            of League's best — and worst — skins.
          </p>
          <Link to="/battle" className={`group ${btnPrimary}`}>
            Battle Now
            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-4 transition-transform duration-150 group-hover:translate-x-1"
            />
          </Link>
        </div>
      </section>
    </>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-shadow-hero font-serif text-2xl md:text-3xl font-bold text-gold1">
        {value}
      </div>
      <div className="text-sm uppercase tracking-widest text-grey1">{label}</div>
    </div>
  )
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="mb-12 text-center">
      <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold2">
        {title}
      </h2>
      <p className="mt-3 mx-auto max-w-2xl text-lg text-grey1">{subtitle}</p>
    </div>
  )
}
