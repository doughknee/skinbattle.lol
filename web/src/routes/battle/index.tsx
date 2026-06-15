import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useAnimate, useReducedMotion } from 'motion/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowTrendUp,
  faBan,
  faCompress,
  faExpand,
  faFire,
  faKeyboard,
  faRotateLeft,
  faShuffle,
  faStar,
  faUser,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import { usePostHog } from 'posthog-js/react'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import TodayStrip from '~/components/games/TodayStrip'
import { AnimatedNumber } from '~/components/games/AnimatedNumber'
import {
  fetchDailyHub,
  fetchQuickBattle,
  submitBattleUndo,
  submitBattleVote,
} from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { countBattleAndMaybeOffer, SUPPORT_URL } from '~/lib/support'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { captureSkinVote } from '~/lib/analytics'
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

// ─── battle cards ───────────────────────────────────────────────────────────

// How a pair arrives on stage. 'reveal': the one-time first-load ceremony.
// 'round': the per-pick square-up entrance. 'settled': no entrance (the pair
// is mid-verdict). There's no loading gate - the card frame + entrance play
// immediately and each splash blur-ups into place as it decodes.
type Entrance = 'reveal' | 'round' | 'settled'

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
  // Splash blur-up: the image fades + sharpens into place as it decodes, so
  // there's no loading skeleton to hide behind. Preloaded/cached splashes are
  // already `complete`, where onLoad may not fire - so check on mount too.
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  useEffect(() => {
    if (imgRef.current?.complete) setImgLoaded(true)
  }, [])
  const verdictAnim =
    verdict === 'winner'
      ? 'animate-battle-win z-10'
      : verdict === 'loser'
        ? 'animate-battle-lose'
        : ''
  // The gold frame lives on a dedicated overlay (below) that paints ABOVE the
  // splash. An inset outline on the card itself gets covered the instant the
  // image takes its hover transform — that's the old "the scale eats the
  // border" bug. winner crowns the frame gold; otherwise it ignites on hover.
  const frameTone =
    verdict === 'winner'
      ? 'outline-gold2'
      : 'outline-icon/20 group-hover:outline-gold2'
  const entranceAnim =
    entrance === 'reveal'
      ? side === 'a'
        ? 'animate-battle-reveal-a'
        : 'animate-battle-reveal-b'
      : entrance === 'round'
        ? side === 'a'
          ? 'animate-battle-in-a'
          : 'animate-battle-in-b'
        : ''
  return (
    <div
      className={`card-sheen-host group relative aspect-video w-full overflow-hidden bg-hextech-black/60 transition duration-200 hover:shadow-glow ${entranceAnim} ${verdictAnim}`}
    >
      <motion.button
        onClick={() => onPick(skin.skinId)}
        aria-label={`Pick ${skin.name}`}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 800, damping: 26 }}
        className="block h-full w-full cursor-pointer text-left"
      >
        <img
          ref={imgRef}
          src={skin.splashUrl}
          alt={`${skin.name} splash art`}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={() => onBroken(skin.skinId)}
          className={`h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.04] group-hover:brightness-110 group-hover:saturate-[1.06] ${
            imgLoaded
              ? 'scale-100 opacity-100 blur-0'
              : 'scale-105 opacity-0 blur-sm'
          }`}
        />
        {/* A single rake of gold light across the splash on hover-in — the
            "legendary skin catching the light" beat. Clipped by the card's
            overflow. */}
        <span aria-hidden className="card-sheen" />
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-hextech-black/95 via-hextech-black/60 to-transparent px-4 pb-3 pt-10"
        >
          <span className="font-serif text-lg font-bold leading-tight text-gold1 md:text-xl">
            {skin.name}
          </span>
          <span className="text-sm text-grey1">{skin.championName}</span>
        </span>
      </motion.button>
      {/* Frame overlay: always painted above the splash so the hover transform
          can never cover it. -outline-offset keeps it inside the card edge. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-10 outline -outline-offset-2 transition duration-200 ${frameTone}`}
      />
      <span className="absolute left-2 top-2 z-10 flex gap-1.5">
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

// A battle-count number that rolls on change (Motion+ odometer, loaded
// client-only by AnimatedNumber so it never runs server-side).
function AnimatedCount({ value }: { value: number }) {
  return <AnimatedNumber value={value} />
}

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
          <span className="text-grey1">
            beat <span className="text-gold1/80">{feedback.loserName}</span>
          </span>
          <span className="text-gold2">
            <FontAwesomeIcon icon={faArrowTrendUp} className="mr-1 h-3.5" />#
            {feedback.rank}
            {feedback.rankBefore !== null &&
              feedback.rankBefore > feedback.rank && (
                // The win: a pick that pushed this skin UP the ranking. The
                // climb is the payoff, so make it obvious - count it up (Motion+
                // odometer) and pop it big. Only shows on real rank gains.
                <span className="animate-delta-pop delta-glow ml-1.5 inline-flex items-baseline gap-0.5 text-base font-bold text-blue2 [animation-delay:120ms] md:text-lg">
                  ↑
                  <AnimatedNumber value={feedback.rankBefore - feedback.rank} />
                </span>
              )}
          </span>
          {/* The always-true lever: this pick is now part of a growing,
              kept-for-good pile of evidence deciding this skin's place. Honest
              even when the rank doesn't visibly move, and never overclaims a
              single pick. The raw +delta (half-strength for guests, and pure
              measurement) is deliberately gone. */}
          <span className="text-grey1">
            decided by{' '}
            <b className="text-gold1">{feedback.battles.toLocaleString()}</b>{' '}
            {feedback.battles === 1 ? 'battle' : 'battles'} and counting
          </span>
          {feedback.agreementPct !== null && (
            <span className="text-grey1">
              ·{' '}
              <b className="text-gold1">
                <AnimatedNumber value={feedback.agreementPct} />%
              </b>{' '}
              agree with you
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-grey1">
          Pick the one you like more. Every vote moves the{' '}
          <Link
            to="/rankings"
            className="font-bold text-gold1 underline-offset-2 transition duration-150 hover:underline"
          >
            rankings
          </Link>
          .
        </p>
      )}
    </div>
  )
}

// ─── located standing (the "needle") ────────────────────────────────────────

// The wordless needle the FeedbackBar narrates: where the just-won skin
// actually SITS in the whole rated field, flanked by its named rivals. No
// per-pick motion - an honest 0-2 rank move is sub-pixel on a 1,400-deep
// field, so faking visible movement would lie. Felt weight comes from a real,
// named place: "you put this skin at #789, right behind X, just ahead of Y."
// Lives below the bar (never above the cards), so its height never disturbs
// the act; renders only once a verdict exists, then stays put across picks.
function Standing({ feedback }: { feedback: BattleFeedback | null }) {
  if (!feedback) return null
  const { neighborAbove, neighborBelow } = feedback
  // A subordinate caption of the beat, not a second sentence: it hugs the line
  // above (-mt) and runs smaller/dimmer, so the eye reads one verdict with a
  // "where it landed" detail. No winner name (the beat just said it).
  return (
    <p
      key={feedback.winnerSkinId}
      className="animate-feedback-pop -mt-3 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 px-2 pb-1 text-center text-xs text-grey1/70"
    >
      <span>
        <span className="font-bold text-gold2/90">
          #{feedback.rank.toLocaleString()}
        </span>
        {feedback.ratedCount > 0 && (
          <> of {feedback.ratedCount.toLocaleString()}</>
        )}
      </span>
      {(neighborAbove || neighborBelow) && (
        <span aria-hidden className="text-grey1/40">
          ·
        </span>
      )}
      {neighborAbove && (
        <span>
          just behind <span className="text-grey1">{neighborAbove.name}</span>
        </span>
      )}
      {neighborAbove && neighborBelow && (
        <span aria-hidden className="text-grey1/40">
          ·
        </span>
      )}
      {neighborBelow && (
        <span>
          just ahead of <span className="text-grey1">{neighborBelow.name}</span>
        </span>
      )}
    </p>
  )
}

// ─── session history ────────────────────────────────────────────────────────

interface HistorySkin {
  skinId: string
  name: string
  championName: string
  splashUrl: string
}

interface HistoryEntry {
  id: number
  winner: HistorySkin
  loser: HistorySkin
  rank: number
  agreementPct: number | null
}

const HISTORY_CAP = 8

// This session's verdicts, newest first: each row shows the matchup you
// decided (winner's splash bright, loser's dimmed), where the winner now sits,
// and how the room agreed. The newest pick carries an Undo that re-opens the
// exact matchup. Lives below the arena so growing it never shifts the cards.
function SessionHistory({
  entries,
  canUndo,
  onUndo,
  undoing,
}: {
  entries: HistoryEntry[]
  canUndo: boolean
  onUndo: () => void
  undoing: boolean
}) {
  if (entries.length === 0) return null
  return (
    <section className="mx-auto mt-12 max-w-2xl">
      <h2 className="mb-3 text-center font-serif text-lg font-bold text-gold2">
        Your verdicts this session
      </h2>
      <ol className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <li
            key={e.id}
            className={`flex items-center gap-3 bg-hextech-black/30 p-2 outline outline-icon/10 -outline-offset-1 ${
              i === 0 ? 'animate-history-in' : ''
            }`}
          >
            <img
              src={e.winner.splashUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-10 w-16 shrink-0 object-cover outline outline-gold2/60 -outline-offset-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-bold text-gold1">{e.winner.name}</span>
                <span className="text-grey1"> over </span>
                <span className="text-grey1">{e.loser.name}</span>
              </p>
              <p className="truncate text-xs text-grey1/60">
                {e.winner.championName} vs {e.loser.championName}
              </p>
            </div>
            <img
              src={e.loser.splashUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="hidden h-10 w-16 shrink-0 object-cover opacity-40 grayscale outline outline-icon/20 -outline-offset-1 sm:block"
            />
            <div className="shrink-0 text-right text-xs leading-tight">
              <p className="font-bold text-gold2">#{e.rank.toLocaleString()}</p>
              {e.agreementPct !== null && (
                <p className="text-grey1/70">{e.agreementPct}% agree</p>
              )}
            </div>
            {i === 0 && canUndo && (
              <button
                onClick={onUndo}
                disabled={undoing}
                title="Undo this pick and decide the matchup again"
                className="flex shrink-0 cursor-pointer items-center gap-1.5 self-stretch bg-hextech-black/60 px-2.5 text-xs font-bold text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faRotateLeft} className="h-3" />
                Undo
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-center text-sm text-grey1">
        Every verdict sharpens the{' '}
        <Link
          to="/battle/mirror"
          className="font-bold text-gold1 underline-offset-2 transition duration-150 hover:underline"
        >
          tier list
        </Link>{' '}
        your picks are building.
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
  const posthog = usePostHog()
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
  // Screen-shake on each pick: a short, decaying jolt of the whole arena (the
  // classic "impact" juice). Driven imperatively via useAnimate so it replays
  // every pick without remounting the arena; skipped under reduced-motion.
  const [arenaRef, animateArena] = useAnimate()
  const reduceMotion = useReducedMotion()
  // Whether the newest verdict can still be taken back. True right after a pick,
  // false once undone (the server only keeps the single most-recent pick).
  const [canUndo, setCanUndo] = useState(false)
  const [undoing, setUndoing] = useState(false)
  // Which side is being acknowledged as the pick, during the hold beat.
  const [pickedSide, setPickedSide] = useState<'a' | 'b' | null>(null)
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
        // Guest hit the only sign-in-gated action - capture the intent so the
        // activation funnel has its missing first step (most guests leak here).
        posthog.capture('auth_prompt_clicked', {
          trigger: 'star_ban_gate',
          source: 'battle_arena',
          skin_id: skinId,
        })
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
        // Resolve the on-screen skin so the event carries skin_name +
        // champion_id like the other surfaces (only the current pair can be
        // marked). viewRef avoids adding `view` to the callback's deps.
        const onScreen = viewRef.current.current
        const marked = [onScreen.a, onScreen.b].find((s) => s.skinId === skinId)
        if (next.star !== prev.star) {
          captureSkinVote(posthog, next.star ? 'star' : 'unstar', {
            skinId,
            skinName: marked?.name,
            championId: marked?.championId,
            used: now.usedStars,
            source: 'battle_arena',
          })
          toast(
            next.star
              ? `Star ${now.usedStars}/${MAX_STARS} used`
              : `Star removed. ${now.usedStars}/${MAX_STARS} used`,
            'success',
          )
        }
        if (next.x !== prev.x) {
          captureSkinVote(posthog, next.x ? 'ban' : 'unban', {
            skinId,
            skinName: marked?.name,
            championId: marked?.championId,
            used: now.usedX,
            source: 'battle_arena',
          })
          toast(
            next.x
              ? `Ban ${now.usedX}/${MAX_X} used`
              : `Ban removed. ${now.usedX}/${MAX_X} used`,
            'success',
          )
        }
        window.dispatchEvent(new CustomEvent('updateUserStats'))
      } catch (err) {
        setMarks((m) => new Map(m).set(skinId, prev))
        toast(err instanceof Error ? err.message : 'Vote failed', 'error')
      } finally {
        markBusyRef.current = false
      }
    },
    [isAuthenticated, login, posthog, withApiToken],
  )

  // Manual-refit runs report through the console (the trigger is an admin
  // affordance, not a player surface).
  useEffect(() => {
    if (initial.refit) console.log('rating refit:', initial.refit)
  }, [initial.refit])

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
      // settles (faster than the network) is dropped, not queued.
      if (!v.next || busyRef.current) return
      busyRef.current = true

      const voted = v.current
      const winnerSkin = voted.a.skinId === winnerId ? voted.a : voted.b
      const loserSkin = voted.a.skinId === winnerId ? voted.b : voted.a
      recentRef.current = [
        ...recentRef.current,
        voted.a.skinId,
        voted.b.skinId,
      ].slice(-16)
      picksMadeRef.current += 1
      setSession((s) => s + 1)
      setPickedSide(winnerId === voted.a.skinId ? 'a' : 'b')
      // The hit: a short, decaying jolt of the whole arena. Transform-only,
      // overlaps the free 280ms beat, skipped under reduced-motion.
      if (!reduceMotion && arenaRef.current) {
        void animateArena(
          arenaRef.current,
          { x: [0, -6, 5, -3, 2, 0], rotate: [0, -0.5, 0.4, -0.2, 0.1, 0] },
          { duration: 0.26, ease: 'easeOut' },
        )
      }

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
        posthog.capture('battle_vote_submitted', {
          winner_skin_id: winnerId,
          winner_skin_name: res.feedback.winnerName,
          loser_skin_name: res.feedback.loserName,
          elo_delta: res.feedback.delta,
          winner_rank: res.feedback.rank,
          agreement_pct: res.feedback.agreementPct,
          session_picks: picksMadeRef.current,
          player_tier: res.stats.tier,
        })
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
              winner: {
                skinId: winnerSkin.skinId,
                name: winnerSkin.name,
                championName: winnerSkin.championName,
                splashUrl: winnerSkin.splashUrl,
              },
              loser: {
                skinId: loserSkin.skinId,
                name: loserSkin.name,
                championName: loserSkin.championName,
                splashUrl: loserSkin.splashUrl,
              },
              rank: res.feedback.rank,
              agreementPct: res.feedback.agreementPct,
            },
            ...h,
          ].slice(0, HISTORY_CAP),
        )
        setCanUndo(true)
        // The one-time honeyfruit moment: fires on the 50th lifetime battle
        // vote, then never again (see ~/lib/support).
        if (countBattleAndMaybeOffer()) {
          toast(
            '50 battles in! Enjoying it? Toss the dev a honeyfruit',
            'info',
            { href: SUPPORT_URL, durationMs: 9000 },
          )
        }
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
    [resync, reduceMotion, animateArena, arenaRef],
  )

  // Take back the most recent pick: the server reverses both ratings and hands
  // the exact matchup back to decide again. Shares busyRef with pick() so the
  // two never overlap; feedback clears so the beat/standing reset to "decide".
  const undoLast = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setUndoing(true)
    try {
      const res = await submitBattleUndo({
        data: { restoreToken: guestRestoreToken() },
      })
      if (!res) {
        setCanUndo(false)
        toast('Nothing to undo.', 'info')
        return
      }
      setView((prev) => ({
        ...prev,
        current: res.pair,
        feedback: null,
        stats: res.stats,
      }))
      setHistory((h) => h.slice(1))
      setSession((s) => Math.max(0, s - 1))
      setCanUndo(false)
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Couldn't undo that pick.",
        'error',
      )
    } finally {
      setUndoing(false)
      busyRef.current = false
    }
  }, [])

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
  // First load plays the one-time reveal ceremony; every pair after it gets the
  // per-round square-up entrance. During the verdict beat nothing re-enters.
  const entrance: Entrance =
    pickedSide !== null
      ? 'settled'
      : picksMadeRef.current === 0
        ? 'reveal'
        : 'round'

  // One arena, two stages: the same cards render into the normal page flow
  // or into the theater overlay. The card grid is keyed per pair so each
  // matchup remounts and plays its entrance; the VS badge lives OUTSIDE the
  // keyed grid so it persists across rounds instead of being torn down and
  // rebuilt every pick - it slams once at the reveal, then only pulses
  // (inner span, keyed per pair) as each new matchup lands. Both moves are
  // transform/opacity-only; the glow is static (.vs-glow), never keyframed.
  const arena = (
    <div ref={arenaRef} className="relative w-full">
      <div
        key={current.token}
        className={`grid w-full grid-cols-1 md:grid-cols-2 ${
          theater ? 'gap-2 md:gap-3' : 'gap-3 md:gap-4'
        }`}
      >
        <BattleCard
          skin={current.a}
          side="a"
          verdict={
            pickedSide ? (pickedSide === 'a' ? 'winner' : 'loser') : null
          }
          onPick={pick}
          onBroken={broken}
          entrance={entrance}
          marks={marks.get(current.a.skinId) ?? NO_MARKS}
          onMark={castMark}
        />
        <BattleCard
          skin={current.b}
          side="b"
          verdict={
            pickedSide ? (pickedSide === 'b' ? 'winner' : 'loser') : null
          }
          onPick={pick}
          onBroken={broken}
          entrance={entrance}
          marks={marks.get(current.b.skinId) ?? NO_MARKS}
          onMark={castMark}
        />
      </div>
      <span
        className={`pointer-events-none absolute left-1/2 top-1/2 z-10 block -translate-x-1/2 -translate-y-1/2 ${
          entrance === 'reveal' ? 'animate-vs-slam' : ''
        }`}
      >
        {/* The strike connecting: a ring flung outward from the badge on each
            pick (keyed by the session count so it replays). Behind the VS text;
            the badge persists across rounds, so this never fights the remount. */}
        {session > 0 && (
          <>
            <span
              key={`flash-${session}`}
              aria-hidden
              className="animate-vs-flash absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-gold2/50 blur-md"
            />
            <span
              key={`ring-${session}`}
              aria-hidden
              className="animate-vs-impact absolute left-1/2 top-1/2 h-12 w-12 rounded-full outline outline-[3px] outline-gold2"
            />
          </>
        )}
        <span
          key={current.token}
          className={`vs-glow flex h-12 w-12 items-center justify-center rounded-full bg-hextech-black/90 font-serif text-sm font-bold text-gold2 outline outline-gold5 -outline-offset-2 ${
            entrance === 'round' ? 'animate-vs-round' : ''
          }`}
        >
          VS
        </span>
      </span>
    </div>
  )

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Endless · which do you like more?
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
            Head-to-Head
          </h1>
          <div className="flex items-center gap-3">
            {/* Your slice next to the room: session + your lifetime, then the
                community total - one glance at where your picks sit in the whole. */}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-grey1">
              {session > 0 && (
                <span className="flex items-center gap-1.5 font-bold text-gold2">
                  <FontAwesomeIcon icon={faFire} className="h-3.5" />
                  <span className="tabular-nums">
                    <AnimatedCount value={session} /> this session
                  </span>
                </span>
              )}
              {stats.total > 0 && (
                <span className="flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faUser} className="h-3.5 text-gold2" />
                  <span className="tabular-nums">
                    <b className="text-gold1">
                      <AnimatedCount value={stats.total} />
                    </b>{' '}
                    battles fought
                  </span>
                </span>
              )}
              {stats.community > 0 && (
                <span className="flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faUsers} className="h-3.5 text-gold2" />
                  <span className="tabular-nums">
                    <b className="text-gold1">
                      <AnimatedCount value={stats.community} />
                    </b>{' '}
                    community
                  </span>
                </span>
              )}
            </p>
            {/* Arena controls: off the splash and on the existing title row, so
                no row is added and the game isn't pushed down. */}
            {!theater && (
              <div
                className="flex shrink-0 items-center gap-1.5"
              >
                <span
                  title="← and → to vote"
                  aria-label="Keyboard: left and right arrow keys vote"
                  className="hidden h-8 w-8 cursor-help items-center justify-center bg-hextech-black/70 text-grey1 outline outline-icon/30 -outline-offset-1 md:flex"
                >
                  <FontAwesomeIcon icon={faKeyboard} className="h-3.5 text-gold2/80" />
                </span>
                <button
                  onClick={() => setTheater(true)}
                  aria-label="Enter theater mode"
                  title="Theater mode"
                  className="flex h-8 w-8 cursor-pointer items-center justify-center bg-hextech-black/70 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2"
                >
                  <FontAwesomeIcon icon={faExpand} className="h-3.5" />
                </button>
              </div>
            )}
          </div>
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
                  <span className="tabular-nums">
                    <AnimatedCount value={session} /> this session
                  </span>
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
          <Standing feedback={feedback} />
        </>
      )}

      {stats.tier === 'guest' && (
        // Reframed from a penalty ("counts less") into the honest upgrade path:
        // raw votes are kept for good and move the personal taste model at full
        // strength now; the community-side half-weight is reversible - the refit
        // re-weights the whole history to full on sign-in (see games/ratings).
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-grey1">
          <FontAwesomeIcon icon={faShuffle} className="mr-1.5 h-3 text-gold2" />
          You're signed out, but nothing's lost: every pick is saved and already
          shaping your own taste at full strength. They count at half toward the
          community ranking for now —{' '}
          <button
            onClick={login}
            className="cursor-pointer font-bold text-gold1 underline-offset-2 transition duration-150 hover:underline"
          >
            sign in
          </button>{' '}
          and all of them upgrade to full, retroactively.
        </p>
      )}

      <SessionHistory
        entries={history}
        canUndo={canUndo}
        onUndo={undoLast}
        undoing={undoing}
      />

      {/* The rest of the door: today's daily puzzles - the old games hub,
          living under the arena. */}
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
