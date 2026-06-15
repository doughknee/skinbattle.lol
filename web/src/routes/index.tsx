import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faBan,
  faHourglassHalf,
  faScaleUnbalanced,
  faStar,
} from '@fortawesome/free-solid-svg-icons'
import { usePostHog } from 'posthog-js/react'
import SkinCard from '~/components/SkinCard'
import EmptyState from '~/components/EmptyState'
import { HomeSkeleton } from '~/components/Skeletons'
import { toast } from '~/components/Toaster'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { fetchHome } from '~/lib/games/serverFns'
import { SITE_SECTIONS } from '~/lib/siteMap'
import { btnPrimary, btnSecondary, btnSecondarySm } from '~/lib/ui'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { captureSkinVote } from '~/lib/analytics'
import type { HomeSlide, HomeState } from '~/lib/games/types'
import type { Skin } from '~/lib/types'

// A guaranteed-valid base splash used if the games catalog has nothing yet.
const FALLBACK_SPLASH =
  'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Jhin_0.jpg'

// One hero slide plus its community star/ban totals from the Go API.
type Slide = HomeSlide & { totalStars: number; totalX: number }

export const Route = createFileRoute('/')({
  loader: async () => {
    // Three independent sources; each degrades on its own so the page
    // always renders. The hero set comes from the games catalog, the vote
    // totals and trending grid from the Go API.
    const [homeRes, championsRes, awardsRes] = await Promise.allSettled([
      fetchHome(),
      api.champions(),
      api.awards(),
    ])
    const home: HomeState | null =
      homeRes.status === 'fulfilled' ? homeRes.value : null
    const champions =
      championsRes.status === 'fulfilled' ? championsRes.value : null
    const awards = awardsRes.status === 'fulfilled' ? awardsRes.value : null

    const totalsBySkin = new Map((awards?.allSkins ?? []).map((s) => [s.id, s]))
    const slides: Slide[] = (home?.slides ?? []).map((s) => ({
      ...s,
      totalStars: totalsBySkin.get(s.skinId)?.total_stars ?? 0,
      totalX: totalsBySkin.get(s.skinId)?.total_x ?? 0,
    }))

    // Only feature skins that actually have stars - on a cold start the
    // "top starred" list is just arbitrary skins with zero votes.
    const starred = (awards?.topStarred ?? []).filter(
      (s) => (s.total_stars ?? 0) > 0,
    )

    return {
      slides,
      championCount: champions?.length ?? 170,
      skinCount: champions
        ? champions.reduce((n, c) => n + (c.skins?.length ?? 0), 0)
        : (home?.community.catalog ?? 0),
      trending: starred.slice(0, 4),
      community: home?.community ?? null,
      drought: home?.drought ?? null,
    }
  },
  head: () => ({
    meta: [
      {
        name: 'description',
        content:
          'Every League of Legends skin, ranked by head-to-head community battles. Star your favorites, ban the misses, settle the debate.',
      },
    ],
  }),
  pendingComponent: HomeSkeleton,
  component: HomePage,
})

// The Battle door's daily challenges, straight from the site map so the
// home page never drifts from what's actually live.
const battlePages =
  SITE_SECTIONS.find((s) => s.to === '/battle')?.children ?? []
const dailyGames = battlePages.filter((p) => p.group === 'Puzzles')

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

function formatMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function HomePage() {
  const { slides, championCount, skinCount, trending, community, drought } =
    Route.useLoaderData()
  const { isAuthenticated, getApiToken } = useAuth()

  // Signed in: one /user/votes call enriches both the hero plate and the
  // trending grid with the user's own stars/bans. (The awards endpoint only
  // carries user flags on its top lists, not on allSkins.)
  const [mine, setMine] = useState<Map<string, Skin> | null>(null)
  useEffect(() => {
    let cancelled = false
    async function enrich() {
      if (!isAuthenticated) {
        setMine(null)
        return
      }
      const token = await getApiToken()
      if (!token) return
      try {
        const data = await api.userVotes(token)
        if (!cancelled) setMine(new Map(data.skins.map((s) => [s.id, s])))
      } catch {
        /* keep public data */
      }
    }
    enrich()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getApiToken])

  return (
    <>
      <Hero
        slides={slides}
        mine={mine}
        championCount={championCount}
        skinCount={skinCount}
        battleCount={community?.battles ?? 0}
      />
      <BattleTeaser community={community} />
      <DailyChallenges />
      <MostLoved trending={trending} mine={mine} />
      <div className="container mx-auto grid grid-cols-1 gap-6 px-6 py-12 lg:grid-cols-2">
        <DroughtHook drought={drought} />
        <MirrorPitch />
      </div>
      <FinalCta />
    </>
  )
}

/* ── Hero: full-bleed daily slideshow with inline star/ban ─────────────── */

function Hero({
  slides,
  mine,
  championCount,
  skinCount,
  battleCount,
}: {
  slides: Slide[]
  mine: Map<string, Skin> | null
  championCount: number
  skinCount: number
  battleCount: number
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = slides.length

  useEffect(() => {
    if (paused || count < 2) return
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 7000)
    return () => clearInterval(t)
    // `index` in deps restarts the timer after a manual jump, so a click
    // always buys a full interval of reading time.
  }, [paused, count, index])

  const current = slides[index] ?? null

  return (
    <section className="relative min-h-[100dvh] w-full overflow-hidden pb-40">
      {/* Backdrop bleeds 10rem past the first viewport (the section's pb-40)
          and the mask dissolves it into the page gradient across that bleed,
          so the fade into the next section only appears once you scroll. */}
      <div className="pointer-events-none absolute inset-0 mask-b-from-[calc(100%-10rem)]">
        {/* Splash backdrop, crossfading (sits behind the blurred navbar) */}
        {count === 0 ? (
          <img
            src={FALLBACK_SPLASH}
            alt="Jhin splash art"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          slides.map((s, i) => (
            <img
              key={s.skinId}
              src={s.splashUrl}
              alt={i === index ? `${s.name} splash art` : ''}
              aria-hidden={i !== index}
              fetchPriority={i === 0 ? 'high' : undefined}
              className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-1000 ${
                i === index ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ))
        )}
        {/* Legibility + blend overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-hextech-black/95 via-hextech-black/65 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-gradientTop via-transparent to-hextech-black/40" />
      </div>

      <div className="container relative z-10 mx-auto flex min-h-[100dvh] flex-col px-6 pt-28 pb-8">
        <div className="my-auto max-w-2xl">
          <p className="animate-fade-up mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
            Community Skin Rankings
          </p>
          <h1
            className="animate-fade-up text-shadow-hero font-serif text-5xl font-bold leading-[1.05] text-gold1 md:text-7xl"
            style={{ animationDelay: '100ms' }}
          >
            Settle the skin debate.
          </h1>
          <p
            className="animate-fade-up text-shadow-hero mt-6 max-w-xl text-lg text-grey1 md:text-xl"
            style={{ animationDelay: '200ms' }}
          >
            Every League skin, ranked by head-to-head battles. Pick winners,
            star your favorites, ban the misses. The community decides.
          </p>

          <div
            className="animate-fade-up mt-10 flex flex-col gap-4 sm:flex-row"
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
            className="animate-fade-up mt-12 flex flex-wrap gap-x-12 gap-y-6"
            style={{ animationDelay: '400ms' }}
          >
            <Stat value={formatCount(championCount)} label="Champions" />
            {skinCount > 0 && (
              <Stat value={formatCount(skinCount)} label="Skins to rank" />
            )}
            {battleCount > 0 && (
              <Stat value={formatCount(battleCount)} label="Battles fought" />
            )}
          </div>
        </div>

        {current && (
          // In flow below the headline; floats over the splash's bottom-right
          // corner on xl, where there's room beside the headline column, so
          // the whole hero fits one viewport.
          <div
            className="animate-fade-up mt-10 w-full max-w-md lg:self-end xl:absolute xl:right-6 xl:bottom-8 xl:mt-0"
            style={{ animationDelay: '500ms' }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
          >
            <SlidePlate
              slide={current}
              mine={mine}
              index={index}
              count={count}
              onJump={setIndex}
            />
          </div>
        )}
      </div>
    </section>
  )
}

interface SlideVote {
  star: boolean
  x: boolean
  totalStars: number
  totalX: number
}

const plateChip =
  'flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 text-sm font-bold outline -outline-offset-1 transition duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50'
const plateChipIdle =
  'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
const plateChipGold = 'bg-gold5/30 text-gold1 outline-gold2'
const plateChipRed = 'bg-danger-surface/50 text-danger outline-danger-border/70'

// The featured skin's info + inline star/ban. This is the site's voting
// model in miniature: act on it here and you've learned the whole system.
function SlidePlate({
  slide,
  mine,
  index,
  count,
  onJump,
}: {
  slide: Slide
  mine: Map<string, Skin> | null
  index: number
  count: number
  onJump: (i: number) => void
}) {
  const { isAuthenticated, withApiToken, login } = useAuth()
  const posthog = usePostHog()
  const [pending, setPending] = useState(false)
  // Optimistic per-skin overrides on top of loader totals + auth enrichment.
  const [votes, setVotes] = useState<Record<string, SlideVote>>({})
  useEffect(() => setVotes({}), [mine])

  const enriched = mine?.get(slide.skinId)
  const v: SlideVote = votes[slide.skinId] ?? {
    star: enriched?.user_star ?? false,
    x: enriched?.user_x ?? false,
    totalStars: enriched?.total_stars ?? slide.totalStars,
    totalX: enriched?.total_x ?? slide.totalX,
  }

  const cast = async (next: { star: boolean; x: boolean }) => {
    if (!isAuthenticated) {
      // Guest tried to vote from the home hero - record the sign-in intent
      // (the activation funnel's missing first step) before redirecting.
      posthog.capture('auth_prompt_clicked', {
        trigger: 'star_ban_gate',
        source: 'home_hero',
        skin_id: slide.skinId,
      })
      login()
      return
    }
    if (next.star && !v.star && userStatsStore.get().usedStars >= MAX_STARS) {
      toast(`All ${MAX_STARS} stars used. Unstar another skin first.`, 'error')
      return
    }
    if (next.x && !v.x && userStatsStore.get().usedX >= MAX_X) {
      toast(`All ${MAX_X} bans used. Unban another skin first.`, 'error')
      return
    }
    const prev = v
    const optimistic: SlideVote = {
      ...next,
      totalStars: prev.totalStars + (next.star ? 1 : 0) - (prev.star ? 1 : 0),
      totalX: prev.totalX + (next.x ? 1 : 0) - (prev.x ? 1 : 0),
    }
    setVotes((m) => ({ ...m, [slide.skinId]: optimistic }))
    setPending(true)
    try {
      const data = await withApiToken(
        (token) => api.vote({ skinId: slide.skinId, star: next.star, x: next.x }, token),
        'Please sign in to vote.',
      )
      if (data.totals) {
        setVotes((m) => ({
          ...m,
          [slide.skinId]: {
            ...next,
            totalStars: data.totals.total_stars,
            totalX: data.totals.total_x,
          },
        }))
      }
      userStatsStore.adjust({
        stars: next.star === prev.star ? 0 : next.star ? 1 : -1,
        x: next.x === prev.x ? 0 : next.x ? 1 : -1,
      })
      const used = userStatsStore.get()
      if (next.star !== prev.star) {
        captureSkinVote(posthog, next.star ? 'star' : 'unstar', {
          skinId: slide.skinId,
          skinName: slide.name,
          championId: slide.championId,
          used: used.usedStars,
          source: 'home_hero',
        })
        toast(
          next.star
            ? `Star ${used.usedStars}/${MAX_STARS} used`
            : `Star removed. ${used.usedStars}/${MAX_STARS} used`,
          'success',
        )
      }
      if (next.x !== prev.x) {
        captureSkinVote(posthog, next.x ? 'ban' : 'unban', {
          skinId: slide.skinId,
          skinName: slide.name,
          championId: slide.championId,
          used: used.usedX,
          source: 'home_hero',
        })
        toast(
          next.x
            ? `Ban ${used.usedX}/${MAX_X} used`
            : `Ban removed. ${used.usedX}/${MAX_X} used`,
          'success',
        )
      }
      window.dispatchEvent(new CustomEvent('updateUserStats'))
    } catch (err) {
      setVotes((m) => ({ ...m, [slide.skinId]: prev }))
      toast(err instanceof Error ? err.message : 'Vote failed', 'error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="border-t-2 border-t-gold5 bg-hextech-black/70 p-5 outline outline-icon/30 -outline-offset-1 backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-gold2/80">
          Today's showcase
        </p>
        <span className="text-xs tabular-nums text-grey1">
          {index + 1} / {count}
        </span>
      </div>

      <Link
        to="/skins/$slug"
        params={{ slug: slide.slug }}
        className="font-serif text-2xl font-bold text-gold1 transition duration-150 hover:text-gold2"
      >
        {slide.name}
      </Link>
      <p className="mt-1 text-sm text-grey1">
        {slide.championName}
        {slide.cost != null && <> · {formatCount(slide.cost)} RP</>}
        {slide.rank != null ? (
          <> · Elo rank #{formatCount(slide.rank)}</>
        ) : (
          <> · Unranked, no battles yet</>
        )}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => cast({ star: !v.star, x: v.x })}
          disabled={pending}
          aria-pressed={v.star}
          aria-label={v.star ? `Unstar ${slide.name}` : `Star ${slide.name}`}
          title={v.star ? 'Remove star' : `Star this skin (${MAX_STARS} max)`}
          className={`${plateChip} ${v.star ? plateChipGold : plateChipIdle}`}
        >
          <FontAwesomeIcon icon={faStar} className="h-3.5" />
          <span className="tabular-nums">{v.totalStars}</span>
          {v.star ? 'Starred' : 'Star'}
        </button>
        <button
          onClick={() => cast({ star: v.star, x: !v.x })}
          disabled={pending}
          aria-pressed={v.x}
          aria-label={v.x ? `Unban ${slide.name}` : `Ban ${slide.name}`}
          title={v.x ? 'Remove ban' : `Ban this skin (${MAX_X} max)`}
          className={`${plateChip} ${v.x ? plateChipRed : plateChipIdle}`}
        >
          <FontAwesomeIcon icon={faBan} className="h-3.5" />
          <span className="tabular-nums">{v.totalX}</span>
          {v.x ? 'Banned' : 'Ban'}
        </button>
      </div>

      <p className="mt-3 text-xs text-grey1/80">
        {isAuthenticated
          ? `You get ${MAX_STARS} stars and ${MAX_X} bans. Spend them with conviction.`
          : `Sign in to spend your ${MAX_STARS} stars and ${MAX_X} bans.`}
      </p>

      {count > 1 && (
        <div className="mt-4 flex items-center gap-2">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              onClick={() => onJump(i)}
              aria-label={`Show slide ${i + 1}`}
              aria-current={i === index}
              className={`h-1.5 cursor-pointer transition-all duration-300 ${
                i === index
                  ? 'w-8 bg-gold2'
                  : 'w-4 bg-icon/40 hover:bg-icon'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Battle teaser ─────────────────────────────────────────────────────── */

function BattleTeaser({ community }: { community: HomeState['community'] | null }) {
  return (
    <section className="container mx-auto px-6 py-24 text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
        The main event
      </p>
      <h2 className="font-serif text-3xl font-bold text-gold2 md:text-5xl">
        Two skins enter. You decide.
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-grey1">
        Head-to-head battles feed an Elo rating for every skin. No setup, no
        account needed. Your first pick already moves the rankings.
      </p>

      {community && community.battles > 0 && (
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-14 gap-y-6">
          <Stat
            value={formatCount(community.battles)}
            label="Battles fought"
            center
          />
          <Stat
            value={formatCount(community.rated)}
            label="Skins ranked"
            center
          />
          <Stat
            value={formatCount(community.catalog)}
            label="In the catalog"
            center
          />
        </div>
      )}

      <div className="mt-10">
        <Link to="/battle" className={`group ${btnPrimary}`}>
          Settle it yourself
          <FontAwesomeIcon
            icon={faArrowRight}
            className="h-4 transition-transform duration-150 group-hover:translate-x-1"
          />
        </Link>
      </div>
    </section>
  )
}

/* ── Daily challenges ──────────────────────────────────────────────────── */

function DailyChallenges() {
  return (
    <section className="container mx-auto px-6 py-12">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-bold text-gold2 md:text-4xl">
            Today's Challenges
          </h2>
          <p className="mt-2 text-lg text-grey1">
            Three dailies, the same puzzles for everyone. Fresh at midnight
            UTC.
          </p>
        </div>
        <Link
          to="/battle/leaderboards"
          className="hidden whitespace-nowrap items-center gap-2 font-serif font-bold text-grey1 transition duration-150 hover:text-gold1 sm:inline-flex"
        >
          Leaderboards
          <FontAwesomeIcon icon={faArrowRight} className="h-4" />
        </Link>
      </div>
      <div className="stagger grid grid-cols-1 gap-6 sm:grid-cols-3">
        {dailyGames.map((g) => (
          <Link
            key={g.to}
            to={g.to}
            className="group bg-hextech-black/30 p-8 outline outline-icon/20 -outline-offset-2 transition duration-150 hover:outline-icon"
          >
            <FontAwesomeIcon icon={g.icon} className="mb-4 h-9 w-9 text-gold2" />
            <h3 className="mb-2 font-serif text-xl font-bold text-gold1 transition duration-150 group-hover:text-gold2">
              {g.label}
            </h3>
            <p className="text-grey1">{g.blurb}</p>
            <p className="mt-4 text-sm font-bold text-gold2/80">
              Play today's puzzle
              <FontAwesomeIcon
                icon={faArrowRight}
                className="ml-2 h-3 transition-transform duration-150 group-hover:translate-x-1"
              />
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ── Most loved (live, auth-enriched) ──────────────────────────────────── */

function MostLoved({
  trending,
  mine,
}: {
  trending: Skin[]
  mine: Map<string, Skin> | null
}) {
  const skins = useMemo(
    () => trending.map((s) => mine?.get(s.id) ?? s),
    [trending, mine],
  )
  return (
    <section className="container mx-auto px-6 py-12">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-bold text-gold2 md:text-4xl">
            Most Loved Right Now
          </h2>
          <p className="mt-2 text-lg text-grey1">
            The skins collecting the most stars. Yours count the moment you
            cast them.
          </p>
        </div>
        <Link
          to="/rankings/awards"
          className="hidden whitespace-nowrap items-center gap-2 font-serif font-bold text-grey1 transition duration-150 hover:text-gold1 sm:inline-flex"
        >
          View all awards
          <FontAwesomeIcon icon={faArrowRight} className="h-4" />
        </Link>
      </div>
      {skins.length === 0 ? (
        <EmptyState
          icon={faStar}
          title="No stars awarded yet"
          message={`The throne is empty. Be the first to crown a favorite: every player gets ${MAX_STARS} stars to spend.`}
          cta={{ to: '/champions', label: 'Start Voting' }}
          compact
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {skins.map((skin) => (
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
  )
}

/* ── Drought hook + Mirror pitch ───────────────────────────────────────── */

function DroughtHook({ drought }: { drought: HomeState['drought'] | null }) {
  if (!drought || drought.top.length === 0) return null
  const lead = drought.top[0]
  return (
    <section className="relative flex flex-col overflow-hidden border-t-2 border-t-gold5 bg-hextech-black/40 outline outline-icon/20 -outline-offset-1">
      <img
        src={lead.lastSkinSplashUrl}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-top opacity-25"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-hextech-black/95 via-hextech-black/70 to-hextech-black/40" />
      <div className="relative flex flex-1 flex-col p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <FontAwesomeIcon icon={faHourglassHalf} className="mr-2 h-3.5" />
          The Drought Index
        </p>
        <h3 className="font-serif text-2xl font-bold text-gold1 md:text-3xl">
          {lead.championName} has waited {formatCount(lead.days)} days for a
          new skin.
        </h3>
        <p className="mt-3 text-grey1">
          Last one: {lead.lastSkinName}, {formatMonth(lead.lastSkinDate)}.
          {drought.stats.overTwoYears > 1 && (
            <>
              {' '}
              {formatCount(drought.stats.overTwoYears)} champions have waited
              two years or more.
            </>
          )}
        </p>
        <ul className="mt-5 space-y-2 text-sm text-grey1">
          {drought.top.slice(1).map((row) => (
            <li key={row.championId} className="flex justify-between gap-4">
              <span className="font-bold text-gold1/90">
                #{row.rank} {row.championName}
              </span>
              <span className="tabular-nums">{formatCount(row.days)} days</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-8">
          <Link to="/rankings/drought" className={`group ${btnSecondarySm}`}>
            See every champion's wait
            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-4 transition-transform duration-150 group-hover:translate-x-1"
            />
          </Link>
        </div>
      </div>
    </section>
  )
}

function MirrorPitch() {
  return (
    <section className="flex flex-col border-t-2 border-t-gold5 bg-hextech-black/40 p-8 outline outline-icon/20 -outline-offset-1">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
        <FontAwesomeIcon icon={faScaleUnbalanced} className="mr-2 h-3.5" />
        The Mirror
      </p>
      <h3 className="font-serif text-2xl font-bold text-gold1 md:text-3xl">
        Every battle builds your tier list.
      </h3>
      <p className="mt-3 text-grey1">
        Your picks quietly train a personal S to D ranking of your taste. The
        Mirror holds it up against the community: your hottest takes, the
        skin lines you over-index on, the champions you've fully judged.
      </p>
      <p className="mt-3 text-grey1">
        No forms, no setup. Just battle, then look in the Mirror.
      </p>
      <div className="mt-auto pt-8">
        <Link to="/battle/mirror" className={`group ${btnSecondarySm}`}>
          See your reflection
          <FontAwesomeIcon
            icon={faArrowRight}
            className="h-4 transition-transform duration-150 group-hover:translate-x-1"
          />
        </Link>
      </div>
    </section>
  )
}

/* ── Final CTA ─────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="container mx-auto px-6 pb-32 pt-12">
      <div className="relative overflow-hidden border-t-2 border-t-gold5 bg-hextech-black/40 px-8 py-16 text-center outline outline-icon/20 -outline-offset-2">
        <h2 className="mb-4 font-serif text-3xl font-bold text-gold2 md:text-5xl">
          The debate ends here.
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-grey1">
          Every pick sharpens the list. Jump in, the next matchup is already
          waiting.
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link to="/battle" className={`group ${btnPrimary}`}>
            Battle Now
            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-4 transition-transform duration-150 group-hover:translate-x-1"
            />
          </Link>
          <Link to="/champions" className={btnSecondary}>
            Browse the catalog
          </Link>
        </div>
      </div>
    </section>
  )
}

function Stat({
  value,
  label,
  center = false,
}: {
  value: string
  label: string
  center?: boolean
}) {
  return (
    <div className={center ? 'text-center' : undefined}>
      <div className="text-shadow-hero font-serif text-2xl font-bold text-gold1 md:text-3xl">
        {value}
      </div>
      <div className="text-sm uppercase tracking-widest text-grey1">{label}</div>
    </div>
  )
}
