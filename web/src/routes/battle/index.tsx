import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowTrendUp,
  faBan,
  faCompress,
  faExpand,
  faFire,
  faShuffle,
  faStar,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import TodayStrip from '~/components/games/TodayStrip'
import {
  fetchDailyHub,
  fetchQuickBattle,
  submitBattleVote,
} from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
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
  // - no loading states, and the first pick is instant.
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
      { title: 'Battle · Skin Battle' },
      {
        name: 'description',
        content:
          'Two League skins. Pick the one you like more. Every vote builds the community ranking.',
      },
      ...ogMeta({
        title: 'Battle · Skin Battle',
        description:
          'Two League skins. Pick the one you like more. Every vote builds the community ranking, and your personal tier list.',
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
// runs concurrently with the network - it costs nothing.
const PICK_HOLD_MS = 280

// Upper bound on the first-load gate: if both splashes haven't decoded by
// then, the reveal plays anyway over whatever has arrived. The <head>
// preloads make the happy path tens of milliseconds - this only exists so
// a struggling CDN can't hold the page hostage.
const REVEAL_GATE_MAX_MS = 2000

// ─── battle cards ───────────────────────────────────────────────────────────

// How a pair arrives on stage. 'gate': held as a shimmering slab while the
// first pair's splashes decode. 'reveal': the one-time first-load ceremony.
// 'round': the quick per-pick entrance. 'settled': no entrance (the pair is
// mid-verdict).
type Entrance = 'gate' | 'reveal' | 'round' | 'settled'

// The viewer's catalog marks (star/ban) for one skin.
interface Marks {
  star: boolean
  x: boolean
}

const NO_MARKS: Marks = { star: false, x: false }

const markChip =
  'flex h-8 w-8 cursor-pointer items-center justify-center outline -outline-offset-1 transition duration-150 active:scale-[0.94]'
const markIdle =
  'bg-hextech-black/70 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-gold2'
const markGold = 'bg-gold5/40 text-gold1 outline-gold2'
const markRed = 'bg-danger-surface/60 text-danger outline-danger-border/70'

function BattleCard({
  skin,
  side,
  verdict,
  onPick,
  onBroken,
  entrance,
  marks,
  onMark,
}: {
  skin: BattleSkin
  side: 'a' | 'b'
  // During the acknowledgment beat: how this card fared.
  verdict: 'winner' | 'loser' | null
  onPick: (skinId: string) => void
  onBroken: (skinId: string) => void
  entrance: Entrance
  // Catalog star/ban: picking decides the battle, these crown (or condemn)
  // the skin itself - the two currencies, woven into one surface.
  marks: Marks
  onMark: (skinId: string, next: Marks) => void
}) {
  const verdictAnim =
    verdict === 'winner'
      ? 'animate-battle-win z-10 outline-gold2'
      : verdict === 'loser'
        ? 'animate-battle-lose'
        : ''
  const entranceAnim =
    entrance === 'reveal'
      ? side === 'a'
        ? 'animate-battle-reveal-a'
        : 'animate-battle-reveal-b'
      : entrance === 'round'
        ? side === 'a'
          ? 'animate-battle-in-a'
          : 'animate-battle-in-b'
        : entrance === 'gate'
          ? 'skeleton'
          : ''
  // Behind the gate the card is a branded shimmer slab: the <img> is mounted
  // (so it downloads and decodes) but invisible until the reveal plays.
  const gated = entrance === 'gate' ? 'opacity-0' : ''
  return (
    <div
      className={`group relative aspect-video w-full overflow-hidden bg-hextech-black/60 outline outline-icon/20 -outline-offset-2 transition duration-150 hover:outline-gold2 ${entranceAnim} ${verdictAnim}`}
    >
      <button
        onClick={() => onPick(skin.skinId)}
        aria-label={`Pick ${skin.name}`}
        className="block h-full w-full cursor-pointer text-left"
      >
        <img
          src={skin.splashUrl}
          alt={`${skin.name} splash art`}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onError={() => onBroken(skin.skinId)}
          className={`h-full w-full object-cover transition duration-200 group-hover:scale-[1.03] ${gated}`}
        />
        <span
          className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-hextech-black/95 via-hextech-black/60 to-transparent px-4 pb-3 pt-10 ${gated}`}
        >
          <span className="font-serif text-lg font-bold leading-tight text-gold1 md:text-xl">
            {skin.name}
          </span>
          <span className="text-sm text-grey1">{skin.championName}</span>
        </span>
      </button>
      <span className={`absolute left-2 top-2 z-10 flex gap-1.5 ${gated}`}>
        <button
          onClick={() => onMark(skin.skinId, { star: !marks.star, x: marks.x })}
          aria-pressed={marks.star}
          aria-label={marks.star ? `Unstar ${skin.name}` : `Star ${skin.name}`}
          title={
            marks.star ? 'Remove star' : `Star this skin (${MAX_STARS} max)`
          }
          className={`${markChip} ${marks.star ? markGold : markIdle}`}
        >
          <FontAwesomeIcon icon={faStar} className="h-3.5" />
        </button>
        <button
          onClick={() => onMark(skin.skinId, { star: marks.star, x: !marks.x })}
          aria-pressed={marks.x}
          aria-label={marks.x ? `Unban ${skin.name}` : `Ban ${skin.name}`}
          title={marks.x ? 'Remove ban' : `Ban this skin (${MAX_X} max)`}
          className={`${markChip} ${marks.x ? markRed : markIdle}`}
        >
          <FontAwesomeIcon icon={faBan} className="h-3.5" />
        </button>
      </span>
    </div>
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
          <span className="animate-delta-pop delta-glow inline-block text-base font-bold text-blue2 md:text-lg">
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
                // Pops a beat after the delta - rank climbing is the payoff.
                <span className="animate-delta-pop ml-1 inline-block font-bold text-blue2 [animation-delay:120ms]">
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
          Pick the one you like more. Every vote moves the rankings.
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

// The answer to "wait, what did I just vote on?" - this session's verdicts,
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
        Every verdict sharpens the tier list your picks are building.
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
  const { isAuthenticated, getApiToken, withApiToken, login } = useAuth()
  const [view, setView] = useState<View>({
    current: initial.pair,
    next: initial.next,
    feedback: null,
    stats: initial.stats,
  })
  // The viewer's catalog star/ban marks, keyed by skin id, so the chips on
  // rotating battle cards reflect prior votes. Loaded once when auth
  // resolves; local toggles overlay it optimistically.
  const [marks, setMarks] = useState<Map<string, Marks>>(new Map())
  const marksRef = useRef(marks)
  marksRef.current = marks
  const markBusyRef = useRef(false)
  const [session, setSession] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  // Which side is being acknowledged as the pick, during the hold beat.
  const [pickedSide, setPickedSide] = useState<'a' | 'b' | null>(null)
  // False until the first pair's splashes have decoded (or the gate times
  // out) - flipping it plays the reveal ceremony. SSR and the pre-hydration
  // paint both render the gated state, so the gate holds from first paint.
  const [revealed, setRevealed] = useState(false)
  const revealedRef = useRef(false)
  // Theater mode: the arena takes over the viewport in a fixed overlay.
  const [theater, setTheater] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const busyRef = useRef(false)
  // Skins shown recently in this session - the matchmaker avoids re-serving
  // them. Variety only; the server never trusts this list for anything else.
  const recentRef = useRef<string[]>([])
  const picksMadeRef = useRef(0)

  useEffect(() => {
    rememberGuestToken(initial.guestToken)
  }, [initial.guestToken])

  useEffect(() => {
    let cancelled = false
    if (!isAuthenticated) {
      setMarks(new Map())
      return
    }
    void (async () => {
      const token = await getApiToken()
      if (!token) return
      try {
        const data = await api.userVotes(token)
        if (!cancelled)
          setMarks(
            new Map(
              data.skins.map((s) => [
                s.id,
                { star: s.user_star ?? false, x: s.user_x ?? false },
              ]),
            ),
          )
      } catch {
        /* chips start unmarked; voting still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getApiToken])

  // Catalog star/ban from the arena: same budget rules and optimistic flow
  // as SkinCard, against the page-level marks map.
  const castMark = useCallback(
    async (skinId: string, next: Marks) => {
      if (!isAuthenticated) {
        login()
        return
      }
      if (markBusyRef.current) return
      const prev = marksRef.current.get(skinId) ?? NO_MARKS
      const used = userStatsStore.get()
      if (next.star && !prev.star && used.usedStars >= MAX_STARS) {
        toast(`All ${MAX_STARS} stars used. Unstar another skin first.`, 'error')
        return
      }
      if (next.x && !prev.x && used.usedX >= MAX_X) {
        toast(`All ${MAX_X} bans used. Unban another skin first.`, 'error')
        return
      }
      markBusyRef.current = true
      setMarks((m) => new Map(m).set(skinId, next))
      try {
        await withApiToken(
          (token) => api.vote({ skinId, star: next.star, x: next.x }, token),
          'Please sign in to vote.',
        )
        userStatsStore.adjust({
          stars: next.star === prev.star ? 0 : next.star ? 1 : -1,
          x: next.x === prev.x ? 0 : next.x ? 1 : -1,
        })
        const now = userStatsStore.get()
        if (next.star !== prev.star)
          toast(
            next.star
              ? `Star ${now.usedStars}/${MAX_STARS} used`
              : `Star removed. ${now.usedStars}/${MAX_STARS} used`,
            'success',
          )
        if (next.x !== prev.x)
          toast(
            next.x
              ? `Ban ${now.usedX}/${MAX_X} used`
              : `Ban removed. ${now.usedX}/${MAX_X} used`,
            'success',
          )
        window.dispatchEvent(new CustomEvent('updateUserStats'))
      } catch (err) {
        setMarks((m) => new Map(m).set(skinId, prev))
        toast(err instanceof Error ? err.message : 'Vote failed', 'error')
      } finally {
        markBusyRef.current = false
      }
    },
    [isAuthenticated, login, withApiToken],
  )

  // Manual-refit runs report through the console (the trigger is an admin
  // affordance, not a player surface).
  useEffect(() => {
    if (initial.refit) console.log('rating refit:', initial.refit)
  }, [initial.refit])

  // The full-load gate: hold the reveal until BOTH splashes have actually
  // decoded, so the ceremony never plays over half-painted images. The
  // <head> preloads usually make this near-instant; the race caps how long
  // a slow CDN can hold the page. A decode failure opens the gate too -
  // the visible card's onError path owns broken-splash recovery.
  useEffect(() => {
    let alive = true
    const decoded = (url: string) => {
      const img = new Image()
      img.src = url
      return img.decode().catch(() => {})
    }
    void Promise.race([
      Promise.all([
        decoded(initial.pair.a.splashUrl),
        decoded(initial.pair.b.splashUrl),
      ]),
      sleep(REVEAL_GATE_MAX_MS),
    ]).then(() => {
      if (!alive) return
      revealedRef.current = true
      setRevealed(true)
    })
    return () => {
      alive = false
    }
  }, [initial.pair])

  // Theater chrome: Esc backs out, and the page behind the overlay keeps
  // its scroll position.
  useEffect(() => {
    if (!theater) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTheater(false)
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = prevOverflow
    }
  }, [theater])

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
      toast("Couldn't fetch a new matchup. Try refreshing.", 'error')
    }
  }, [])

  const pick = useCallback(
    async (winnerId: string) => {
      const v = viewRef.current
      // The only wait in the loop: a pick before the previous round trip
      // settles (faster than the network) is dropped, not queued. No voting
      // on a pair that's still behind the first-load gate either.
      if (!revealedRef.current || !v.next || busyRef.current) return
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
      // costs nothing - by the time the next pair steps in, the feedback is
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
        /* handled after the hold - this just silences the unhandled gap */
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
            : "That pick didn't count. Try again.",
          'error',
        )
        await resync()
      } finally {
        busyRef.current = false
      }
    },
    [resync],
  )

  // A broken splash in the ON-SCREEN pair (CDN hiccup - the catalog sweep
  // benches known-dead ones): skip the pair and remember the skin.
  const broken = useCallback(
    (skinId: string) => {
      recentRef.current = [...recentRef.current, skinId].slice(-16)
      void resync()
    },
    [resync],
  )

  // A broken splash in the PRELOADED pair: swap in a replacement quietly,
  // before the player ever sees it - the on-screen battle is not touched.
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
  // The first pair holds behind the gate until its splashes decode, then
  // plays the one-time reveal ceremony; every pair after it gets the quick
  // per-round entrance. During the verdict beat nothing re-enters.
  const entrance: Entrance = !revealed
    ? 'gate'
    : pickedSide !== null
      ? 'settled'
      : picksMadeRef.current === 0
        ? 'reveal'
        : 'round'

  const vsAnim =
    entrance === 'gate'
      ? 'opacity-0'
      : entrance === 'reveal'
        ? 'animate-vs-slam'
        : entrance === 'round'
          ? 'animate-vs-pop'
          : ''

  // One arena, two stages: the same cards render into the normal page flow
  // or into the theater overlay. Keyed per pair so each matchup remounts
  // and plays its entrance.
  const arena = (
    <div
      key={current.token}
      className={`relative grid w-full grid-cols-1 md:grid-cols-2 ${
        theater ? 'gap-2 md:gap-3' : 'gap-3 md:gap-4'
      }`}
    >
      <BattleCard
        skin={current.a}
        side="a"
        verdict={pickedSide ? (pickedSide === 'a' ? 'winner' : 'loser') : null}
        onPick={pick}
        onBroken={broken}
        entrance={entrance}
        marks={marks.get(current.a.skinId) ?? NO_MARKS}
        onMark={castMark}
      />
      <BattleCard
        skin={current.b}
        side="b"
        verdict={pickedSide ? (pickedSide === 'b' ? 'winner' : 'loser') : null}
        onPick={pick}
        onBroken={broken}
        entrance={entrance}
        marks={marks.get(current.b.skinId) ?? NO_MARKS}
        onMark={castMark}
      />
      <span
        className={`pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-hextech-black/90 font-serif text-sm font-bold text-gold2 outline outline-gold5 -outline-offset-2 ${vsAnim}`}
      >
        VS
      </span>
      {!theater && (
        <button
          onClick={() => setTheater(true)}
          aria-label="Enter theater mode"
          title="Theater mode"
          className={`absolute right-2 top-2 z-20 flex h-9 w-9 cursor-pointer items-center justify-center bg-hextech-black/70 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2 ${
            revealed ? '' : 'pointer-events-none opacity-0'
          }`}
        >
          <FontAwesomeIcon icon={faExpand} className="h-4" />
        </button>
      )}
    </div>
  )

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Endless · which do you like more?
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
            Head-to-Head
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

      {/* The arena. Stacked on mobile (thumb-first - share links open on
          phones), side by side from md up. In theater mode it relocates
          into the fullscreen overlay below; everything else on the page
          stays put behind it. */}
      {theater ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Battle theater"
          className="fixed inset-0 z-[85] flex flex-col bg-hextech-black"
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <p className="flex items-baseline gap-4 text-xs font-semibold uppercase tracking-[0.3em] text-gold2">
              Which do you like more?
              {session > 0 && (
                <span className="flex items-center gap-1.5 text-sm normal-case tracking-normal text-gold1">
                  <FontAwesomeIcon icon={faFire} className="h-3" />
                  {session} this session
                </span>
              )}
            </p>
            <button
              onClick={() => setTheater(false)}
              aria-label="Exit theater mode"
              title="Exit theater (Esc)"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center bg-hextech-black/60 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2"
            >
              <FontAwesomeIcon icon={faCompress} className="h-4" />
            </button>
          </div>
          {/* m-auto centers the arena and degrades to scrolling on windows
              too short for it. The max-widths keep both cards on screen:
              stacked (8/9 = one 16:9 card ÷ 2) below md, side by side
              (32/9 = two 16:9 cards) above. */}
          <div className="flex min-h-0 flex-1 overflow-y-auto px-3">
            <div className="m-auto w-full max-w-[calc((100dvh-13rem)*8/9)] md:max-w-[calc((100dvh-11rem)*32/9)]">
              {arena}
            </div>
          </div>
          <FeedbackBar feedback={feedback} />
          <p className="hidden pb-3 text-center text-xs text-grey1 md:block">
            ← and → vote · Esc exits theater
          </p>
        </div>
      ) : (
        <>
          {arena}
          <FeedbackBar feedback={feedback} />
        </>
      )}

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

      {stats.tier === 'guest' && (
        <p className="mt-10 text-sm text-grey1">
          <FontAwesomeIcon icon={faShuffle} className="mr-1.5 h-3 text-gold2" />
          Playing as a guest: your picks count at reduced weight. Sign in to
          vote at full strength.
        </p>
      )}

      <SessionHistory entries={history} />

      {/* The rest of the door: today's dailies, fresh patch skins, and the
          leaderboards - the old games hub, living under the arena. */}
      <TodayStrip hub={hub} />

      {/* Preload the next pair's splashes while the current one is on screen
          - by the time it's dealt in, both images are already decoded. A
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
