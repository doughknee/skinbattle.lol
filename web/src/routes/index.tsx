import { createFileRoute, Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUp,
  faArrowDown,
  faStar,
  faBan,
  faGamepad,
  faTrophy,
  faComments,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import SkinCard from '~/components/SkinCard'
import { api } from '~/lib/api'
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
  component: HomePage,
})

const steps: { icon: IconDefinition; title: string; blurb: string }[] = [
  { icon: faArrowUp, title: 'Upvote', blurb: 'Push the skins you love up the rankings.' },
  { icon: faArrowDown, title: 'Downvote', blurb: 'Send the misses to the bottom.' },
  {
    icon: faStar,
    title: 'Star (×3)',
    blurb: 'Crown your all-time favorites. You only get three.',
  },
  {
    icon: faBan,
    title: 'Ban (×3)',
    blurb: 'Mark the ones that missed the mark. Three bans, choose wisely.',
  },
]

const upcoming: { icon: IconDefinition; title: string; blurb: string }[] = [
  {
    icon: faGamepad,
    title: 'Skin-Based Games',
    blurb:
      'Compete in challenges that test your skin knowledge, with rewards driven by community votes.',
  },
  {
    icon: faTrophy,
    title: 'Leaderboards & Achievements',
    blurb:
      'Track your votes, climb the rankings, and unlock achievements for your contributions.',
  },
  {
    icon: faComments,
    title: 'Polls & Discussions',
    blurb:
      'Join skin-specific debates, vote on upcoming features, and help shape the platform.',
  },
]

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
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
              Community Skin Rankings
            </p>
            <h1 className="text-shadow-hero font-serif text-5xl md:text-7xl font-bold leading-[1.05] text-gold1">
              Settle the skin debate.
            </h1>
            <p className="text-shadow-hero mt-6 max-w-xl text-lg md:text-xl text-grey1">
              Stop scrolling endless Reddit threads. Vote, star, and ban your way
              to a definitive, community-built ranking of every League skin.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link to="/champions" className={`group ${btnPrimary}`}>
                Start Voting
                <FontAwesomeIcon
                  icon={faArrowRight}
                  className="h-4 transition-transform duration-150 group-hover:translate-x-1"
                />
              </Link>
              <Link to="/awards" className={btnSecondary}>
                See the Awards
              </Link>
            </div>

            {/* Stat strip */}
            <div className="mt-14 flex flex-wrap gap-x-12 gap-y-6">
              <Stat value={formatCount(championCount)} label="Champions" />
              {skinCount > 0 && (
                <Stat value={formatCount(skinCount)} label="Skins to rank" />
              )}
              <Stat value="Upvote · Star · Ban" label="Cast your verdict" />
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="container mx-auto px-6 py-24">
        <SectionHeading
          title="How It Works"
          subtitle="Four ways to weigh in. The community average decides the rankings."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
      {trending.length > 0 && (
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
              to="/awards"
              className="hidden sm:inline-flex items-center gap-2 font-serif font-bold text-grey1 hover:text-gold1 transition duration-150 whitespace-nowrap"
            >
              View all awards
              <FontAwesomeIcon icon={faArrowRight} className="h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {trending.map((skin: Skin) => (
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

      {/* ── What's coming next ───────────────────────────────── */}
      <section className="container mx-auto px-6 py-24">
        <SectionHeading
          title="What's Coming Next"
          subtitle="SkinBattle is just getting started. Here's what's on the way."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {upcoming.map((f) => (
            <div
              key={f.title}
              className="bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-8 transition duration-150 hover:outline-icon"
            >
              <FontAwesomeIcon icon={f.icon} className="h-9 w-9 text-gold2 mb-4" />
              <h3 className="font-serif text-xl font-bold text-gold1 mb-2">
                {f.title}
              </h3>
              <p className="text-grey1">{f.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="container mx-auto px-6 pb-32 pt-8">
        <div className="relative overflow-hidden border-t-2 border-t-gold5 outline outline-icon/20 -outline-offset-2 bg-hextech-black/40 px-8 py-16 text-center">
          <h2 className="font-serif text-3xl md:text-5xl font-bold text-gold2 mb-4">
            Ready to crown the best?
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-grey1 mb-8">
            Jump in and start ranking. Every vote shapes the definitive list of
            League's best — and worst — skins.
          </p>
          <Link to="/champions" className={`group ${btnPrimary}`}>
            Start Voting
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
