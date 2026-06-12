import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowTrendUp,
  faFire,
  faRankingStar,
  faShuffle,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import TodayStrip from '~/components/games/TodayStrip'
import { btnSecondarySm } from '~/lib/ui'
import {
  fetchDailyHub,
  fetchQuickBattle,
  submitBattleVote,
} from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import type {
  BattleFeedback,
  BattlePair,
  BattleSkin,
  BattleStats,
} from '~/lib/games/types'

export const Route = createFileRoute('/battle/')({
  // ?refit=<secret> is the manual Bradley-Terry refit trigger (cron/curl
  // hits this URL; the loader passes it through to the server).
  validateSearch: (s: Record<string, unknown>): { refit?: string } =>
    typeof s.refit === 'string' ? { refit: s.refit } : {},
  loaderDeps: ({ search }) => ({ refit: search.refit }),
  // /battle is the door AND the game: Quick Battle plays at the top, the
  // daily-challenges strip renders below. Both payloads load in parallel
  // BEFORE the route renders (SSR on first visit, prefetched on navigation)
  // — no loading states, and the first pick is instant.
  loader: async ({ deps }) => {
    const restoreToken = guestRestoreToken()
    const [qb, hub] = await Promise.all([
      fetchQuickBattle({ data: { restoreToken, refit: deps.refit } }),
      fetchDailyHub({ data: { restoreToken } }),
    ])
    return { qb, hub }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: 'Battle — Skin Battle' },
      {
        name: 'description',
        content:
          'Two League skins. Pick the one you like more. Every vote builds the community ranking.',
      },
      ...ogMeta({
        title: 'Battle — Skin Battle',
        description:
          'Two League skins. Pick the one you like more. Every vote builds the community ranking — and your personal tier list.',
        card: 'quick-battle',
        path: '/battle',
      }),
    ],
    // Start the splash downloads from the <head>, before the body parses or
    // React hydrates: the visible pair at high priority, the on-deck pair at
    // low. The preconnect saves the DNS+TLS round trip on the first one.
    links: [
      {
        rel: 'preconnect',
        href: 'https://ddragon.leagueoflegends.com',
      },
      ...(loaderData
        ? [
            { pair: loaderData.qb.pair, priority: 'high' as const },
            { pair: loaderData.qb.next, priority: 'low' as const },
          ].flatMap(({ pair, priority }) =>
            [pair.a, pair.b].map((s) => ({
              rel: 'preload',
              as: 'image',
              href: s.splashUrl,
              fetchPriority: priority,
            })),
          )
        : []),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't start the battle"
      message={error.message}
      back={{ to: '/', label: 'Back home' }}
    />
  ),
  component: BattlePage,
})

// How long the pick is acknowledged (winner blooms, loser concedes) before
// the next pair steps in. The vote request fires at pick time, so this beat
// runs concurrently with the network — it costs nothing.
const PICK_HOLD_MS = 280

// ─── battle cards ───────────────────────────────────────────────────────────

function BattleCard({
  skin,
  side,
  verdict,
  onPick,
  onBroken,
  animate,
}: {
  skin: BattleSkin
  side: 'a' | 'b'
  // During the acknowledgment beat: how this card fared.
  verdict: 'winner' | 'loser' | null
  onPick: (skinId: string) => void
  onBroken: (skinId: string) => void
  // False for the pair that's part of the page's first paint — entrance
  // animations are reserved for pairs that arrive after it.
  animate: boolean
}) {
  const verdictAnim =
    verdict === 'winner'
      ? 'animate-battle-win z-10 outline-gold2'
      : verdict === 'loser'
        ? 'animate-battle-lose'
        : ''
  const entrance = animate
    ? side === 'a'
      ? 'animate-battle-in-a'
      : 'animate-battle-in-b'
    : ''
  return (
    <button
      onClick={() => onPick(skin.skinId)}
      className={`group relative aspect-video w-full cursor-pointer overflow-hidden bg-hextech-black/60 text-left outline outline-icon/20 -outline-offset-2 transition duration-150 hover:outline-gold2 ${entrance} ${verdictAnim}`}
    >
      <img
        src={skin.splashUrl}
        alt={`${skin.name} splash art`}
        loading="eager"
        fetchPriority="high"
        decoding="async"
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
          <span className="animate-delta-pop inline-block font-bold text-blue2">
            +{feedback.delta}
          </span>
          <span className="text-grey1">
            beat <span className="text-gold1/80">{feedback.loserName}</span>
          </span>
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
              · {feedback.rating} ± {feedback.uncertainty}
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

// ─── session history ────────────────────────────────────────────────────────

interface HistoryEntry {
  id: number
  winnerName: string
  loserName: string
  delta: number
  rank: number
  agreementPct: number | null
}

const HISTORY_CAP = 8

// The answer to "wait, what did I just vote on?" — this session's verdicts,
// newest first. Lives below the action buttons so growing it never shifts
// anything interactive.
function SessionHistory({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return null
  return (
    <section className="mt-12 max-w-2xl">
      <h2 className="mb-3 font-serif text-lg font-bold text-gold2">
        Your verdicts this session
      </h2>
      <ol className="flex flex-col gap-1.5">
        {entries.map((e, i) => (
          <li
            key={e.id}
            className={`flex h-10 items-center gap-2 overflow-hidden whitespace-nowrap bg-hextech-black/30 px-3 text-sm outline outline-icon/10 -outline-offset-1 ${
              i === 0 ? 'animate-history-in' : ''
            }`}
          >
            <span className="min-w-0 truncate font-bold text-gold1">
              {e.winnerName}
            </span>
            <span className="shrink-0 font-bold text-blue2">+{e.delta}</span>
            <span className="shrink-0 text-grey1">beat</span>
            <span className="min-w-0 truncate text-grey1">{e.loserName}</span>
            <span className="ml-auto shrink-0 text-gold2">#{e.rank}</span>
            {e.agreementPct !== null && (
              <span className="shrink-0 text-grey1">
                · {e.agreementPct}% agree
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-grey1">
        Every verdict sharpens{' '}
        <Link
          to="/battle/mirror"
          className="font-bold text-gold2 transition duration-150 hover:text-gold1"
        >
          your Mirror
        </Link>{' '}
        — the tier list your picks are building.
      </p>
    </section>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

interface View {
  current: BattlePair
  next: BattlePair | null // null while the replenish round trip is in flight
  feedback: BattleFeedback | null
  stats: BattleStats
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function BattlePage() {
  const { qb: initial, hub } = Route.useLoaderData()
  const [view, setView] = useState<View>({
    current: initial.pair,
    next: initial.next,
    feedback: null,
    stats: initial.stats,
  })
  const [session, setSession] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  // Which side is being acknowledged as the pick, during the hold beat.
  const [pickedSide, setPickedSide] = useState<'a' | 'b' | null>(null)
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

  // Recovery path (vote rejected, broken splash on screen): re-deal both
  // pairs from the server.
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
      setPickedSide(winnerId === voted.a.skinId ? 'a' : 'b')

      // The vote is in flight DURING the acknowledgment beat, so the hold
      // costs nothing — by the time the next pair steps in, the feedback is
      // usually already on its way back.
      const votePromise = submitBattleVote({
        data: {
          pairToken: voted.token,
          winnerId,
          recent: recentRef.current,
          restoreToken: guestRestoreToken(),
        },
      })
      votePromise.catch(() => {
        /* handled after the hold — this just silences the unhandled gap */
      })
      await sleep(PICK_HOLD_MS)
      setPickedSide(null)
      setView((prev) => (prev.next ? { ...prev, current: prev.next, next: null } : prev))

      try {
        const res = await votePromise
        rememberGuestToken(res.guestToken)
        setView((prev) => ({
          ...prev,
          next: res.nextPair,
          feedback: res.feedback,
          stats: res.stats,
        }))
        setHistory((h) =>
          [
            {
              id: res.stats.total,
              winnerName: res.feedback.winnerName,
              loserName: res.feedback.loserName,
              delta: res.feedback.delta,
              rank: res.feedback.rank,
              agreementPct: res.feedback.agreementPct,
            },
            ...h,
          ].slice(0, HISTORY_CAP),
        )
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

  // A broken splash in the ON-SCREEN pair (CDN hiccup — the catalog sweep
  // benches known-dead ones): skip the pair and remember the skin.
  const broken = useCallback(
    (skinId: string) => {
      recentRef.current = [...recentRef.current, skinId].slice(-16)
      void resync()
    },
    [resync],
  )

  // A broken splash in the PRELOADED pair: swap in a replacement quietly,
  // before the player ever sees it — the on-screen battle is not touched.
  const brokenNext = useCallback(async (skinId: string) => {
    recentRef.current = [...recentRef.current, skinId].slice(-16)
    try {
      const s = await fetchQuickBattle({
        data: { restoreToken: guestRestoreToken() },
      })
      setView((prev) => (prev.next ? { ...prev, next: s.pair } : prev))
    } catch {
      // If the replacement fetch fails, the visible-card fallback will
      // recover when (if) the pair is actually shown.
    }
  }, [])

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
  const animatePair = picksMadeRef.current > 0 && pickedSide === null

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
          verdict={pickedSide ? (pickedSide === 'a' ? 'winner' : 'loser') : null}
          onPick={pick}
          onBroken={broken}
          animate={animatePair}
        />
        <BattleCard
          skin={current.b}
          side="b"
          verdict={pickedSide ? (pickedSide === 'b' ? 'winner' : 'loser') : null}
          onPick={pick}
          onBroken={broken}
          animate={animatePair}
        />
        <span
          className={`pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-hextech-black/90 font-serif text-sm font-bold text-gold2 outline outline-gold5 -outline-offset-2 ${
            animatePair ? 'animate-tile-pop' : ''
          }`}
        >
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
        <Link to="/battle/mirror" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faRankingStar} className="h-4" />
          Your Mirror
        </Link>
        {stats.tier === 'guest' && (
          <p className="text-sm text-grey1">
            <FontAwesomeIcon icon={faShuffle} className="mr-1.5 h-3 text-gold2" />
            Playing as a guest — your picks count at reduced weight. Sign in to
            vote at full strength.
          </p>
        )}
      </div>

      <SessionHistory entries={history} />

      {/* The rest of the door: today's dailies, fresh patch skins, and the
          leaderboards — the old games hub, living under the arena. */}
      <TodayStrip hub={hub} />

      {/* Preload the next pair's splashes while the current one is on screen
          — by the time it's dealt in, both images are already decoded. A
          preload that 403s gets its pair replaced before it's ever shown. */}
      {view.next && (
        <div aria-hidden className="hidden">
          <img
            src={view.next.a.splashUrl}
            alt=""
            onError={() => void brokenNext(view.next!.a.skinId)}
          />
          <img
            src={view.next.b.splashUrl}
            alt=""
            onError={() => void brokenNext(view.next!.b.skinId)}
          />
        </div>
      )}
    </div>
  )
}
