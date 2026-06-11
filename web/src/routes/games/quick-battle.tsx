import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faArrowTrendUp,
  faFire,
  faShuffle,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import { btnSecondarySm } from '~/lib/ui'
import { fetchQuickBattle, submitBattleVote } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import type {
  BattleFeedback,
  BattlePair,
  BattleSkin,
  BattleStats,
} from '~/lib/games/types'

export const Route = createFileRoute('/games/quick-battle')({
  // ?refit=<secret> is the manual Bradley-Terry refit trigger (cron/curl
  // hits this URL; the loader passes it through to the server).
  validateSearch: (s: Record<string, unknown>): { refit?: string } =>
    typeof s.refit === 'string' ? { refit: s.refit } : {},
  loaderDeps: ({ search }) => ({ refit: search.refit }),
  // Data loads BEFORE the route renders (SSR on first visit, prefetched on
  // navigation) — the first pair plus its preloaded successor arrive with
  // the page, so there are no loading states and the first pick is instant.
  loader: ({ deps }) =>
    fetchQuickBattle({
      data: { restoreToken: guestRestoreToken(), refit: deps.refit },
    }),
  head: () => ({
    meta: [
      { title: 'Quick Battle — Skin Battle' },
      {
        name: 'description',
        content:
          'Two League skins. Pick the one you like more. Every vote builds the community ranking.',
      },
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't start Quick Battle"
      message={error.message}
      back={{ to: '/games', label: 'Back to games' }}
    />
  ),
  component: QuickBattlePage,
})

// ─── battle cards ───────────────────────────────────────────────────────────

function BattleCard({
  skin,
  side,
  onPick,
  onBroken,
  animate,
}: {
  skin: BattleSkin
  side: 'a' | 'b'
  onPick: (skinId: string) => void
  onBroken: (skinId: string) => void
  // False for the pair that's part of the page's first paint — entrance
  // animations are reserved for pairs that arrive after it.
  animate: boolean
}) {
  return (
    <button
      onClick={() => onPick(skin.skinId)}
      className={`group relative aspect-video w-full cursor-pointer overflow-hidden bg-hextech-black/60 text-left outline outline-icon/20 -outline-offset-2 transition duration-150 hover:outline-gold2 ${
        animate ? 'animate-battle-in' : ''
      }`}
      style={animate && side === 'b' ? { animationDelay: '60ms' } : undefined}
    >
      <img
        src={skin.splashUrl}
        alt={`${skin.name} splash art`}
        onError={() => onBroken(skin.skinId)}
        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-hextech-black/95 via-hextech-black/60 to-transparent px-4 pb-3 pt-10">
        <span className="font-serif text-lg font-bold leading-tight text-gold1 md:text-xl">
          {skin.name}
        </span>
        <span className="text-sm text-grey1">{skin.championName}</span>
      </span>
    </button>
  )
}

// ─── feedback line ──────────────────────────────────────────────────────────

// Fixed-height by design: the bar exists from first paint and only its
// CONTENT swaps, so answering back never reflows the arena above it.
function FeedbackBar({ feedback }: { feedback: BattleFeedback | null }) {
  return (
    <div className="flex h-14 items-center justify-center overflow-hidden px-2 text-center">
      {feedback ? (
        // Keyed per pick so each answer pops in fresh.
        <p
          key={`${feedback.winnerSkinId}-${feedback.battles}`}
          className="animate-feedback-pop flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-sm md:text-base"
        >
          <span className="font-serif font-bold text-gold1">
            {feedback.winnerName}
          </span>
          <span className="font-bold text-blue2">+{feedback.delta}</span>
          <span className="text-gold2">
            <FontAwesomeIcon icon={faArrowTrendUp} className="mr-1 h-3.5" />#
            {feedback.rank}
            {feedback.rankBefore !== null &&
              feedback.rankBefore > feedback.rank && (
                <span className="ml-1 text-blue2">
                  ↑{feedback.rankBefore - feedback.rank}
                </span>
              )}
          </span>
          {feedback.agreementPct !== null ? (
            <span className="text-grey1">
              · <b className="text-gold1">{feedback.agreementPct}%</b> agree
              with you ({feedback.pairVotes} votes)
            </span>
          ) : (
            <span className="text-grey1">
              · {feedback.rating} ± {feedback.uncertainty} ·{' '}
              {feedback.battles}{' '}
              {feedback.battles === 1 ? 'battle' : 'battles'}
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-grey1">
          Pick the one you like more — every vote moves the rankings.
        </p>
      )}
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

interface View {
  current: BattlePair
  next: BattlePair | null // null while the replenish round trip is in flight
  feedback: BattleFeedback | null
  stats: BattleStats
}

function QuickBattlePage() {
  const initial = Route.useLoaderData()
  const [view, setView] = useState<View>({
    current: initial.pair,
    next: initial.next,
    feedback: null,
    stats: initial.stats,
  })
  const [session, setSession] = useState(0)
  const viewRef = useRef(view)
  viewRef.current = view
  const busyRef = useRef(false)
  // Skins shown recently in this session — the matchmaker avoids re-serving
  // them. Variety only; the server never trusts this list for anything else.
  const recentRef = useRef<string[]>([])
  const picksMadeRef = useRef(0)

  useEffect(() => {
    rememberGuestToken(initial.guestToken)
  }, [initial.guestToken])

  // Manual-refit runs report through the console (the trigger is an admin
  // affordance, not a player surface).
  useEffect(() => {
    if (initial.refit) console.log('rating refit:', initial.refit)
  }, [initial.refit])

  // Recovery path (vote rejected, broken splash): re-deal from the server.
  const resync = useCallback(async () => {
    try {
      const s = await fetchQuickBattle({
        data: { restoreToken: guestRestoreToken() },
      })
      rememberGuestToken(s.guestToken)
      setView((v) => ({ ...v, current: s.pair, next: s.next, stats: s.stats }))
    } catch {
      toast("Couldn't fetch a new matchup — try refreshing.", 'error')
    }
  }, [])

  const pick = useCallback(
    async (winnerId: string) => {
      const v = viewRef.current
      // The only wait in the loop: a pick before the previous round trip
      // settles (faster than the network) is dropped, not queued.
      if (!v.next || busyRef.current) return
      busyRef.current = true

      const voted = v.current
      recentRef.current = [
        ...recentRef.current,
        voted.a.skinId,
        voted.b.skinId,
      ].slice(-16)
      picksMadeRef.current += 1
      setSession((s) => s + 1)
      // Advance instantly — the vote settles in the background and answers
      // back into the feedback bar under the pair that's already on screen.
      setView({ ...v, current: v.next, next: null })

      try {
        const res = await submitBattleVote({
          data: {
            pairToken: voted.token,
            winnerId,
            recent: recentRef.current,
            restoreToken: guestRestoreToken(),
          },
        })
        rememberGuestToken(res.guestToken)
        setView((prev) => ({
          ...prev,
          next: res.nextPair,
          feedback: res.feedback,
          stats: res.stats,
        }))
      } catch (err) {
        setSession((s) => s - 1)
        toast(
          err instanceof Error
            ? err.message
            : "That pick didn't count — try again.",
          'error',
        )
        await resync()
      } finally {
        busyRef.current = false
      }
    },
    [resync],
  )

  // A splash that 404s would leave half the matchup invisible — skip the
  // pair and remember the broken skin for this session.
  const broken = useCallback(
    (skinId: string) => {
      recentRef.current = [...recentRef.current, skinId].slice(-16)
      void resync()
    },
    [resync],
  )

  // Desktop: arrow keys keep the loop on the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') void pick(viewRef.current.current.a.skinId)
      else if (e.key === 'ArrowRight')
        void pick(viewRef.current.current.b.skinId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick])

  const { current, feedback, stats } = view
  // The pair on screen at first paint renders settled; every pair after it
  // plays its entrance.
  const animatePair = picksMadeRef.current > 0

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Endless · which do you like more?
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
            Quick B<span className="italic">attle</span>
          </h1>
          <p className="flex items-center gap-4 text-sm text-grey1">
            {session > 0 && (
              <span className="flex items-center gap-1.5 font-bold text-gold2">
                <FontAwesomeIcon icon={faFire} className="h-3.5" />
                {session} this session
              </span>
            )}
            {stats.total > 0 && (
              <span>
                <b className="text-gold1">{stats.total.toLocaleString()}</b>{' '}
                battles fought
              </span>
            )}
          </p>
        </div>
      </header>

      {/* The arena. Stacked on mobile (thumb-first — share links open on
          phones), side by side from md up. Keyed per pair so each matchup
          remounts and plays its entrance. */}
      <div
        key={current.token}
        className="relative grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4"
      >
        <BattleCard
          skin={current.a}
          side="a"
          onPick={pick}
          onBroken={broken}
          animate={animatePair}
        />
        <BattleCard
          skin={current.b}
          side="b"
          onPick={pick}
          onBroken={broken}
          animate={animatePair}
        />
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-hextech-black/90 font-serif text-sm font-bold text-gold2 outline outline-gold5 -outline-offset-2">
          VS
        </span>
      </div>

      <FeedbackBar feedback={feedback} />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="flex items-center gap-2 text-sm text-grey1">
          <FontAwesomeIcon icon={faUsers} className="h-3.5 text-gold2" />
          <span>
            <b className="text-gold1">{stats.community.toLocaleString()}</b>{' '}
            community battles fought
          </span>
        </p>
        <p className="hidden text-sm text-grey1 md:block">
          Tip: ← and → vote with the keyboard.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link to="/games" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          Daily Hub
        </Link>
        {stats.tier === 'guest' && (
          <p className="text-sm text-grey1">
            <FontAwesomeIcon icon={faShuffle} className="mr-1.5 h-3 text-gold2" />
            Playing as a guest — your picks count at reduced weight. Sign in to
            vote at full strength.
          </p>
        )}
      </div>

      {/* Preload the next pair's splashes while the current one is on screen
          — by the time it's dealt in, both images are already decoded. */}
      {view.next && (
        <div aria-hidden className="hidden">
          <img src={view.next.a.splashUrl} alt="" />
          <img src={view.next.b.splashUrl} alt="" />
        </div>
      )}
    </div>
  )
}
