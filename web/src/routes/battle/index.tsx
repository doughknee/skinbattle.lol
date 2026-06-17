import { createFileRoute, Link } from '@tanstack/react-router'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { motion, useAnimate, useReducedMotion, useSpring } from 'motion/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowTrendUp,
  faBolt,
  faCompress,
  faCrown,
  faExpand,
  faFire,
  faKeyboard,
  faMagnifyingGlassPlus,
  faRotateLeft,
  faShuffle,
  faTrophy,
  faUser,
  faUsers,
  faVolumeHigh,
  faVolumeXmark,
} from '@fortawesome/free-solid-svg-icons'
import { usePostHog } from 'posthog-js/react'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import { openLightbox } from '~/components/Lightbox'
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
import {
  initAudio,
  playMilestone,
  playPick,
  playWhoosh,
  playWin,
  setMuted as setSoundMuted,
} from '~/lib/games/battleSound'
import { useAuth } from '~/lib/useAuth'
import { countBattleAndMaybeOffer, SUPPORT_URL } from '~/lib/support'
import type {
  BattleFeedback,
  BattleMode,
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

// Champion mode's best reign survives reloads here (per-device). The live run is
// still in-memory, but the record to chase persists. localStorage key.
const BEST_REIGN_KEY = 'sb_battle_best_reign'

// ─── battle cards ───────────────────────────────────────────────────────────

// How a pair arrives on stage. 'reveal': the one-time first-load ceremony.
// 'round': the per-pick square-up entrance. 'settled': no entrance (the pair
// is mid-verdict). There's no loading gate - the card frame + entrance play
// immediately and each splash blur-ups into place as it decodes.
type Entrance = 'reveal' | 'round' | 'settled'

// The zoom affordance, revealed on hover (touch devices: always shown, since
// there's no :hover). Same magnifier the Tier Drop tiles and rankings cards use.
const zoomReveal =
  'opacity-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-100 group-hover:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto'

// Pointer-tracked 3D tilt (mouse only): the splash leans toward the cursor and
// settles back on a spring — the card catching the light as you move over it.
// TILT_MAX is the lean in degrees at the card's edge; PERSPECTIVE sets how
// pronounced the 3D feels (smaller = more dramatic).
const TILT_MAX = 12
const TILT_PERSPECTIVE = 1000
const TILT_SPRING = { stiffness: 200, damping: 20 }

// ─── champion fire border ─────────────────────────────────────────────────────

// A deep reign rings the king's card in fire — and it never stops escalating.
// Instead of discrete tiers, a continuous "heat" curve of the streak ASYMPTOTES
// toward 1, so the flames keep thickening, brightening, speeding up, throwing
// more embers, and shifting toward a colorful white-hot blaze forever. Bounded
// (never breaks layout or perf) but always nudging; the crown's streak number
// is the literal infinite counter.
const FIRE_START_STREAK = 6

// 0 at the ignition streak, ~0.45 by 12, ~0.67 by 15, ~0.9 by 26, approaching
// (never reaching) 1. Past the old tier-4 ceiling it simply keeps creeping up.
function fireHeat(streak: number): number {
  if (streak < FIRE_START_STREAK) return 0
  return 1 - Math.exp(-(streak - (FIRE_START_STREAK - 1)) / 9)
}

// Palette stops along heat: gold → amber/orange → red → a colorful white-hot/
// violet/cyan blaze. Interpolated continuously — there are no tiers.
const FIRE_STOPS: {
  at: number
  colors: [string, string, string]
  glow: string
}[] = [
  { at: 0, colors: ['#c8aa6e', '#e0a23c', '#ffe6a8'], glow: '#c8aa6e' },
  { at: 0.4, colors: ['#e08a2c', '#ff7a1a', '#ffd27a'], glow: '#ff8a2c' },
  { at: 0.72, colors: ['#ff5a1a', '#e01e1e', '#ffb347'], glow: '#ff4d1a' },
  { at: 1, colors: ['#ff6320', '#a855f7', '#0ac8b9'], glow: '#ff5a2a' },
]

const hexLerp = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const av = (pa >> shift) & 255
    const bv = (pb >> shift) & 255
    return Math.round(av + (bv - av) * t)
  }
  return (
    '#' +
    ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)
  )
}

// Continuous fire parameters for a streak — no tiers, asymptotic in every axis.
function fireParams(streak: number) {
  const heat = fireHeat(streak)
  let lo = FIRE_STOPS[0]
  let hi = FIRE_STOPS[FIRE_STOPS.length - 1]
  for (let i = 0; i < FIRE_STOPS.length - 1; i++) {
    if (heat >= FIRE_STOPS[i].at && heat <= FIRE_STOPS[i + 1].at) {
      lo = FIRE_STOPS[i]
      hi = FIRE_STOPS[i + 1]
      break
    }
  }
  const t = (heat - lo.at) / (hi.at - lo.at || 1)
  const colors: [string, string, string] = [
    hexLerp(lo.colors[0], hi.colors[0], t),
    hexLerp(lo.colors[1], hi.colors[1], t),
    hexLerp(lo.colors[2], hi.colors[2], t),
  ]
  return {
    heat,
    inset: 3 + heat * 5, // 3 → 8 px
    glow: 12 + heat * 36, // 12 → 48 px
    spin: 20 - heat * 11, // 20 → 9 s (crawl speeds up)
    flick: 1.8 - heat * 0.85, // 1.8 → ~0.95 s
    blur: 3 + heat * 4, // 3 → 7 px
    sparks: Math.round(heat * 9), // 0 → 9 embers
    colors,
    glowColor: hexLerp(lo.glow, hi.glow, t),
  }
}

// Stable per-index pseudo-random so each ember keeps its lane/tempo across
// renders — re-randomizing every paint would restart the animation.
const flameHash = (i: number, salt: number) => {
  const x = Math.sin((i + 1) * 99.13 + salt * 17.7) * 43758.5453
  return x - Math.floor(x)
}

function ChampionFire({
  streak,
  reduce,
}: {
  streak: number
  reduce: boolean | null
}) {
  const cfg = fireParams(streak)
  return (
    <>
      {/* The flaming border: a conic gradient of flame colors crawling around
          the whole frame (the card on top leaves only this margin ring visible)
          plus a soft cast glow. The ring edge is crisp — no blur on it. */}
      <div
        aria-hidden
        className="champ-fireborder pointer-events-none"
        style={
          {
            inset: `-${cfg.inset.toFixed(1)}px`,
            boxShadow: `0 0 ${cfg.glow.toFixed(0)}px ${Math.round(cfg.glow * 0.4)}px color-mix(in srgb, ${cfg.glowColor} 55%, transparent)`,
            '--fb-blur': `${cfg.blur.toFixed(1)}px`,
            '--fb-c1': cfg.colors[0],
            '--fb-c2': cfg.colors[1],
            '--fb-c3': cfg.colors[2],
            '--fb-spin': `${cfg.spin.toFixed(1)}s`,
            '--fb-flick': `${cfg.flick.toFixed(2)}s`,
          } as CSSProperties
        }
      />
      {/* Embers spat off the top of the blaze (more as heat climbs). Behind the
          toolbar (z-20), so they wink out cleanly as they rise past the card. */}
      {!reduce && cfg.sparks > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[-4%] bottom-[calc(100%-6px)] h-12"
        >
          {Array.from({ length: cfg.sparks }).map((_, i) => {
            const r = flameHash(i, 1)
            const r2 = flameHash(i, 2)
            const r3 = flameHash(i, 3)
            const color = cfg.colors[i % cfg.colors.length]
            return (
              <span
                key={i}
                className="champ-spark"
                style={
                  {
                    left: `${5 + r * 90}%`,
                    background: color,
                    boxShadow: `0 0 6px ${color}`,
                    '--spark-dur': `${1.7 + r2 * 1.3}s`,
                    '--spark-delay': `${-(r3 * 2.4)}s`,
                    '--spark-rise': `${-(34 + r2 * 40)}px`,
                    '--spark-drift': `${(r - 0.5) * 22}px`,
                  } as CSSProperties
                }
              />
            )
          })}
        </div>
      )}
    </>
  )
}

function BattleCard({
  skin,
  side,
  verdict,
  isChampion,
  streak,
  onPick,
  onBroken,
  entrance,
}: {
  skin: BattleSkin
  side: 'a' | 'b'
  // During the acknowledgment beat: how this card fared.
  verdict: 'winner' | 'loser' | null
  // King-of-the-hill: this card is the reigning champion (lit frame + aura).
  isChampion: boolean
  // Consecutive defences by the reigning champion — drives the aura intensity.
  streak: number
  onPick: (skinId: string) => void
  onBroken: (skinId: string) => void
  entrance: Entrance
}) {
  // Splash blur-up: the image fades + sharpens into place as it decodes, so
  // there's no loading skeleton to hide behind. Preloaded/cached splashes are
  // already `complete`, where onLoad may not fire - so check on mount too.
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  useEffect(() => {
    if (imgRef.current?.complete) setImgLoaded(true)
  }, [])

  // 3D tilt: springs stay neutral until a mouse moves across the card. They live
  // on a dedicated inner layer (below), separate from the entrance/verdict CSS
  // animations on the root — two transforms on one element would fight.
  const reduce = useReducedMotion()
  const tiltRef = useRef<HTMLDivElement>(null)
  const rotateX = useSpring(0, TILT_SPRING)
  const rotateY = useSpring(0, TILT_SPRING)
  const z = useSpring(0, TILT_SPRING)
  // Press-shrink, driven as a shared MotionValue (not whileTap) so the glow +
  // fire layer can ride the exact same scale — a pointer-events-none layer
  // can't run its own tap gesture.
  const pressScale = useSpring(1, { stiffness: 800, damping: 26 })
  // Lean toward the cursor. Mouse only (a touch tap shouldn't tilt), off under
  // reduced motion, and frozen during the win/lose beat so the flourish reads.
  const onTilt = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce || verdict || e.pointerType !== 'mouse' || !tiltRef.current) return
    const r = tiltRef.current.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    rotateX.set(TILT_MAX * (0.5 - py))
    rotateY.set(TILT_MAX * (px - 0.5))
  }
  const press = () => {
    if (!reduce) pressScale.set(0.94)
  }
  const release = () => pressScale.set(1)
  const restTilt = useCallback(() => {
    rotateX.set(0)
    rotateY.set(0)
    z.set(0)
  }, [rotateX, rotateY, z])
  // The verdict beat scales/rotates the whole card via CSS; drop any lean so the
  // two never compound.
  useEffect(() => {
    if (verdict) restTilt()
  }, [verdict, restTilt])

  // The clash: on a pick the winner jabs toward the VS center and snaps back,
  // the loser is knocked the other way. dir points each card toward center
  // ('a' is left → jabs right). The jab rides its OWN out-and-back tween,
  // separate from the scale spring, so neither smears the other.
  const dir = side === 'a' ? -1 : 1
  // The reigning champion (king-of-the-hill) keeps a lit frame and a faint
  // aura that burns brighter the longer the reign — a defence you can see hold.
  const championIdle = isChampion && verdict === null
  const championGlow = championIdle
    ? Math.min(0.2 + (streak - 1) * 0.06, 0.55)
    : 0
  // The crown stays on the king through its winning jab/bloom — it only leaves
  // the card when this card is actually dethroned (verdict === 'loser').
  const showCrown = isChampion && verdict !== 'loser'
  // A long reign catches fire (streak ≥ 6), escalating continuously forever.
  const showFire = showCrown && streak >= FIRE_START_STREAK
  const glowOpacity = verdict === 'winner' ? 1 : championGlow
  const glowScale = verdict === 'winner' ? 1 : championGlow > 0 ? 0.97 : 0.9

  const verdictTarget =
    verdict === 'winner'
      ? {
          opacity: 1,
          x: reduce ? 0 : [0, -dir * 22, 0],
          scale: 1.07,
          rotate: 0,
          filter: 'brightness(1.22) saturate(1.22)',
        }
      : verdict === 'loser'
        ? {
            opacity: 0.22,
            x: reduce ? dir * 8 : dir * 30,
            scale: 0.85,
            rotate: reduce ? 0 : 4.5,
            filter: 'brightness(0.38) saturate(0.05)',
          }
        : {
            opacity: 1,
            x: 0,
            scale: 1,
            rotate: 0,
            filter: 'brightness(1) saturate(1)',
          }
  // Punchy overshoot spring for the win, a hard fast ease-out for the
  // knockback, a snappy settle back to idle/champion. The jab gets its own
  // snap-out-and-back curve, kept off the scale spring.
  const verdictTransition = reduce
    ? { duration: 0.16 }
    : verdict === 'winner'
      ? {
          type: 'spring' as const,
          stiffness: 560,
          damping: 12,
          mass: 0.7,
          x: { duration: 0.4, times: [0, 0.24, 1], ease: 'easeOut' as const },
        }
      : verdict === 'loser'
        ? { duration: 0.22, ease: 'easeOut' as const }
        : { type: 'spring' as const, stiffness: 340, damping: 19, mass: 0.8 }

  // The gold frame lives on a dedicated overlay (below) that paints ABOVE the
  // splash. An inset outline on the card itself gets covered the instant the
  // image takes its hover transform — that's the old "the scale eats the
  // border" bug. Winner crowns it gold; the reigning champion keeps it lit; an
  // idle challenger ignites it on hover.
  const frameTone =
    verdict === 'winner'
      ? 'outline-gold2'
      : verdict === 'loser'
        ? 'outline-icon/10'
        : championIdle
          ? 'outline-gold2/70'
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
    // Layer 1 — sizing + the entrance CSS animation (its own transform). NOT
    // overflow-hidden, so the tilted inner layer is never clipped. The winner
    // lifts above its neighbour during the beat so the bloom/jab read on top.
    <div
      className={`relative aspect-video w-full ${entranceAnim} ${
        verdict === 'winner' ? 'z-10' : ''
      }`}
    >
      {/* Layer 2 — the verdict transform: clash jab / knockback + the win
          bloom scale + filter. Separate element from the tilt layer below so
          their transforms never fight. */}
      <motion.div
        className="relative h-full w-full"
        initial={false}
        animate={verdictTarget}
        transition={verdictTransition}
        style={{ willChange: 'transform' }}
      >
        {/* Glow tilt layer — carries the halo + fire border and shares the
            card's EXACT 3D tilt (same spring MotionValues), so the glow leans
            with the splash. Not overflow-hidden, so the glow/fire spilling past
            the card edge is never clipped. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            rotateX,
            rotateY,
            z,
            scale: pressScale,
            transformPerspective: TILT_PERSPECTIVE,
          }}
        >
          {/* Soft radial halo behind the card — the winner bloom, and the
              champion's streak-scaled aura. A blurred radial gradient (not a
              box-shadow) has no straight edge, so it stays a clean glow even
              while the arena shakes. */}
          <motion.div
            className="absolute -inset-6"
            initial={false}
            animate={{ opacity: glowOpacity, scale: glowScale }}
            transition={{
              duration: verdict === 'winner' ? 0.28 : 0.45,
              ease: 'easeOut',
            }}
            style={{
              background:
                'radial-gradient(68% 68% at 50% 50%, color-mix(in srgb, var(--color-gold2) 55%, transparent), transparent 72%)',
              filter: 'blur(28px)',
              willChange: 'opacity, transform',
            }}
          />
          {/* Champion fire border — rings the whole card once the reign runs
              long, escalating continuously with the streak (no ceiling). */}
          {showFire && <ChampionFire streak={streak} reduce={reduce} />}
        </motion.div>
        {/* Layer 3 — the pointer-tracked 3D tilt, carrying the visual card.
            transformPerspective lives on this element so its rotate reads as 3D. */}
        <motion.div
          ref={tiltRef}
          onPointerMove={onTilt}
          onPointerEnter={(e) => {
            if (!reduce && !verdict && e.pointerType === 'mouse') z.set(-12)
          }}
          onPointerDown={press}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={() => {
            restTilt()
            release()
          }}
          style={{
            rotateX,
            rotateY,
            z,
            scale: pressScale,
            transformPerspective: TILT_PERSPECTIVE,
          }}
          className="card-sheen-host group relative h-full w-full overflow-hidden bg-hextech-black/60 transition-shadow duration-200 hover:shadow-glow"
        >
          {/* The press-shrink lives on the whole card (the tilt layer above),
              not here — scaling just the button would shrink only the splash and
              leave the frame/background behind it, which reads as "only the image
              moved". */}
          <motion.button
            onClick={() => onPick(skin.skinId)}
            aria-label={`Pick ${skin.name}`}
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
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-hextech-black/95 via-hextech-black/60 to-transparent px-4 pb-3 pt-10">
              <span className="font-serif text-lg font-bold leading-tight text-gold1 md:text-xl">
                {skin.name}
              </span>
              <span className="text-sm text-grey1">{skin.championName}</span>
            </span>
          </motion.button>
          {/* Zoom to the full splash — revealed on hover, exactly like the Tier
              Drop tiles. A sibling of the vote button (not nested inside it), so
              zooming the art never casts a vote. */}
          <button
            type="button"
            onClick={() =>
              openLightbox({
                url: skin.splashUrl,
                title: skin.name,
                subtitle: skin.championName,
              })
            }
            aria-label={`View ${skin.name} splash art full screen`}
            title="View full splash art"
            className={`absolute right-2 top-2 z-20 flex h-8 w-8 cursor-zoom-in items-center justify-center bg-hextech-black/75 text-grey1 outline outline-icon/30 -outline-offset-1 backdrop-blur-sm transition hover:text-gold1 hover:outline-gold2 ${zoomReveal}`}
          >
            <FontAwesomeIcon icon={faMagnifyingGlassPlus} className="h-3.5" />
          </button>
          {/* Champion crown — top-left while this card holds the crown, kept on
              through its winning animation so it never blinks mid-streak. */}
          {showCrown && (
            <span
              aria-hidden
              className="absolute left-2 top-2 z-20 flex h-8 items-center gap-1.5 bg-hextech-black/75 px-2 text-gold1 outline outline-gold2/60 -outline-offset-1 backdrop-blur-sm"
            >
              <FontAwesomeIcon icon={faCrown} className="h-3.5" />
              {streak > 1 && (
                <span className="text-xs font-bold tabular-nums">{streak}</span>
              )}
            </span>
          )}
          {/* Frame overlay: always painted above the splash so the hover
              transform can never cover it. -outline-offset keeps it inside the
              card edge. */}
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 z-10 outline -outline-offset-2 transition duration-200 ${frameTone}`}
          />
        </motion.div>
      </motion.div>
    </div>
  )
}

// ─── feedback line ──────────────────────────────────────────────────────────

// A battle-count number that rolls on change (Motion+ odometer, loaded
// client-only by AnimatedNumber so it never runs server-side).
function AnimatedCount({ value }: { value: number }) {
  return <AnimatedNumber value={value} />
}

// A standalone "fun bonus stat": how the rest of the room voted on this exact
// matchup, off the pair's real vote log. Its own pilled callout below the beat
// (not crammed onto the feedback line) - being first or a contrarian is a win
// too, so each case gets its own icon + tone. Pops in keyed per pick.
function ConsensusCallout({ feedback }: { feedback: BattleFeedback | null }) {
  if (!feedback) return null
  const others = feedback.pairVotes - 1 // everyone else ever served this matchup
  const agree = feedback.pairWinnerVotes - 1 // ...who picked your side
  const pct = feedback.agreementPct
  const minority = pct !== null && pct < 50
  const gold = 'bg-gold5/20 text-gold1 outline-gold2/40'
  const blue = 'bg-blue5/30 text-blue1 outline-blue3/50'

  const wrap = (tone: string, icon: typeof faUsers, body: ReactNode) => (
    <div className="mt-1 flex justify-center pb-1">
      <span
        key={feedback.winnerSkinId}
        className={`animate-feedback-pop inline-flex items-center gap-1.5 px-3 py-1 text-sm font-bold outline -outline-offset-1 ${tone}`}
      >
        <FontAwesomeIcon icon={icon} className="h-3.5" />
        {body}
      </span>
    </div>
  )

  if (others <= 0) {
    return wrap(gold, faBolt, <>First to pick this matchup</>)
  }
  if (agree <= 0) {
    return wrap(blue, faFire, <>Bold, you're the only one so far</>)
  }
  return wrap(
    minority ? blue : gold,
    minority ? faFire : faUsers,
    <span>
      {minority && 'Rare take · '}
      <b className="tabular-nums">
        <AnimatedNumber value={agree} />
      </b>{' '}
      {agree === 1 ? 'player agrees' : 'players agree'}
      {pct !== null && (
        <>
          {' · '}
          <AnimatedNumber value={pct} />%
        </>
      )}
    </span>,
  )
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
  // King-of-the-hill state to restore on undo: the streak + reigning skin as
  // they were BEFORE this pick. Null for shuffle picks.
  championBefore?: { streak: number; championSkinId: string | null } | null
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
  const { login } = useAuth()
  const posthog = usePostHog()
  const [view, setView] = useState<View>({
    current: initial.pair,
    next: initial.next,
    feedback: null,
    stats: initial.stats,
  })
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
  // Loop mode. 'shuffle' (default) deals a fresh pair every round; 'champion'
  // is king-of-the-hill — the winner stays on and only the challenger swaps.
  const [mode, setMode] = useState<BattleMode>('shuffle')
  // King-of-the-hill bookkeeping (champion mode only): which slot holds the
  // reigning champion, and its run of consecutive defences.
  const [championSide, setChampionSide] = useState<'a' | 'b' | null>(null)
  const [streak, setStreak] = useState(0)
  // Best reign ever on this device (persisted) — the record to chase.
  const [bestReign, setBestReign] = useState(0)
  // Bumped on every 3rd defence to replay the milestone gold-wash overlay.
  const [flash, setFlash] = useState(0)
  // Sound is on by default; the toggle persists the choice across visits.
  const [muted, setMuted] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const historyRef = useRef(history)
  historyRef.current = history
  const busyRef = useRef(false)
  // Latest values for the pick handler, so it never goes stale or re-binds the
  // keyboard listener every round.
  const modeRef = useRef(mode)
  modeRef.current = mode
  const championSideRef = useRef(championSide)
  championSideRef.current = championSide
  const streakRef = useRef(streak)
  streakRef.current = streak
  // Best reign authoritative live value (read+written synchronously in pick());
  // `bestReign` state mirrors it for display. Plus the best as it stood when the
  // current reign began + whether the one-shot "new best" beat already fired.
  const bestReignRef = useRef(0)
  const reignStartBestRef = useRef(0)
  const recordBeatenRef = useRef(false)
  // Skins shown recently in this session - the matchmaker avoids re-serving
  // them. Variety only; the server never trusts this list for anything else.
  const recentRef = useRef<string[]>([])
  const picksMadeRef = useRef(0)
  // Skin ids on screen as of the last commit — a card whose skin was already
  // shown doesn't replay its entrance (the reigning champion between rounds, or
  // both cards after a non-destructive mode toggle that keeps the matchup).
  const prevSkinsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    rememberGuestToken(initial.guestToken)
  }, [initial.guestToken])

  // Restore the saved mute preference once on the client.
  useEffect(() => {
    if (localStorage.getItem('sb_battle_muted') === '1') setMuted(true)
  }, [])

  // Restore the best reign (per-device record) once on the client.
  useEffect(() => {
    const v = Number(localStorage.getItem(BEST_REIGN_KEY))
    if (Number.isFinite(v) && v > 0) {
      bestReignRef.current = v
      setBestReign(v)
    }
  }, [])

  // Keep the (module-level) sound engine in sync with the toggle.
  useEffect(() => {
    setSoundMuted(muted)
  }, [muted])

  // Remember the on-screen skins after each commit so the next render can tell
  // which card is freshly dealt (and should play its entrance) vs. carried over.
  useEffect(() => {
    prevSkinsRef.current = new Set([
      view.current.a.skinId,
      view.current.b.skinId,
    ])
  }, [view.current.a.skinId, view.current.b.skinId])

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
      // The recovery pair is a fresh, non-anchored shuffle pair, so any reign
      // ends here — otherwise the stale championSide would paint the crown/fire
      // onto a skin that never won.
      if (modeRef.current === 'champion') {
        setChampionSide(null)
        setStreak(0)
      }
    } catch {
      toast("Couldn't fetch a new matchup. Try refreshing.", 'error')
    }
  }, [])

  const pick = useCallback(
    async (winnerId: string) => {
      const v = viewRef.current
      const m = modeRef.current
      // The only wait in the loop: a pick before the previous round trip
      // settles (faster than the network) is dropped, not queued. Shuffle needs
      // the prefetched next pair ready; champion deals its challenger from the
      // vote response, so it doesn't.
      if (busyRef.current || (m === 'shuffle' && !v.next)) return
      busyRef.current = true

      const voted = v.current
      const winnerSide: 'a' | 'b' = voted.a.skinId === winnerId ? 'a' : 'b'
      const winnerSkin = winnerSide === 'a' ? voted.a : voted.b
      const loserSkin = winnerSide === 'a' ? voted.b : voted.a
      recentRef.current = [
        ...recentRef.current,
        voted.a.skinId,
        voted.b.skinId,
      ].slice(-16)
      picksMadeRef.current += 1
      setSession((s) => s + 1)
      setPickedSide(winnerSide)

      // King-of-the-hill bookkeeping: a defence (the winner was already
      // reigning) extends the streak; a dethrone (or shuffle) resets it to 1.
      const prevStreak = streakRef.current
      const prevChampionSide = championSideRef.current
      const champBeforeId = prevChampionSide ? voted[prevChampionSide].skinId : null
      // Compute the prospective streak now (the shake scales with it), but DON'T
      // commit the reign yet — that happens only once the vote actually lands
      // (champion success path below), so a throttled/failed pick can't end a
      // reign it never recorded.
      let newStreak = 0
      let milestone = false
      if (m === 'champion') {
        newStreak = prevChampionSide === winnerSide ? prevStreak + 1 : 1
        milestone = newStreak >= 3 && newStreak % 3 === 0
      }

      // The hit: a short, decaying jolt of the whole arena, scaled by the
      // streak in champion mode (a long reign lands harder). Transform-only,
      // overlaps the free 280ms beat, skipped under reduced-motion.
      if (!reduceMotion && arenaRef.current) {
        const mag = m === 'champion' ? Math.min(6 + newStreak * 1.1, 16) : 6
        void animateArena(
          arenaRef.current,
          {
            x: [0, -mag, mag * 0.7, -mag * 0.45, mag * 0.22, 0],
            rotate: [0, -0.5, 0.4, -0.2, 0.1, 0],
          },
          { duration: 0.26, ease: 'easeOut' },
        )
      }
      // Sound (self-gates when muted): the percussive pick + the win flourish.
      // The milestone fanfare fires on success (with the reign commit) below.
      initAudio()
      playPick()
      playWin()

      // The vote is in flight DURING the acknowledgment beat, so the hold
      // costs nothing - by the time the next pair steps in, the feedback is
      // usually already on its way back.
      const votePromise = submitBattleVote({
        data: {
          pairToken: voted.token,
          winnerId,
          recent: recentRef.current,
          restoreToken: guestRestoreToken(),
          mode: m,
        },
      })
      votePromise.catch(() => {
        /* handled after the hold - this just silences the unhandled gap */
      })

      const newHistoryEntry = (res: Awaited<typeof votePromise>): HistoryEntry => ({
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
        championBefore:
          m === 'champion'
            ? { streak: prevStreak, championSkinId: champBeforeId }
            : null,
      })

      const onVoted = (res: Awaited<typeof votePromise>) => {
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
          battle_mode: m,
          streak: m === 'champion' ? newStreak : undefined,
        })
        setHistory((h) => [newHistoryEntry(res), ...h].slice(0, HISTORY_CAP))
        setCanUndo(true)
        playWhoosh()
        // The one-time honeyfruit moment: fires on the 50th lifetime battle
        // vote, then never again (see ~/lib/support).
        if (countBattleAndMaybeOffer()) {
          toast('50 battles in! Enjoying it? Toss the dev a honeyfruit', 'info', {
            href: SUPPORT_URL,
            durationMs: 9000,
          })
        }
      }

      if (m === 'shuffle') {
        // A shuffle pick deals a fresh pair, so any reign carried over from
        // Champion mode ends here for good (toggling back can't resume it).
        if (championSideRef.current !== null) {
          setChampionSide(null)
          setStreak(0)
        }
        await sleep(PICK_HOLD_MS)
        setPickedSide(null)
        setView((prev) =>
          prev.next ? { ...prev, current: prev.next, next: null } : prev,
        )
        try {
          const res = await votePromise
          setView((prev) => ({
            ...prev,
            next: res.nextPair,
            feedback: res.feedback,
            stats: res.stats,
          }))
          onVoted(res)
        } catch (err) {
          setSession((s) => s - 1)
          const msg =
            err instanceof Error ? err.message : "That pick didn't count. Try again."
          toast(msg, /slow down|battle limit/i.test(msg) ? 'info' : 'error')
          await resync()
        } finally {
          busyRef.current = false
        }
        return
      }

      // Champion mode: the winner stays mounted; only the loser's slot is
      // replaced by the freshly anchored challenger from the vote response. The
      // next pair can't be prefetched (it depends on who won), so we wait the
      // full beat AND the (local, fast) vote before swapping the challenger in.
      try {
        await sleep(PICK_HOLD_MS)
        const res = await votePromise

        // The defence COUNTED — only now commit the reign (so a throttled/failed
        // pick never touches it). A fresh reign (round 1 / dethrone) re-arms the
        // one-shot record celebration; then persist a new personal best.
        if (newStreak === 1) {
          reignStartBestRef.current = bestReignRef.current
          recordBeatenRef.current = false
        }
        setStreak(newStreak)
        setChampionSide(winnerSide)
        let newBest = false
        if (newStreak > bestReignRef.current) {
          bestReignRef.current = newStreak
          setBestReign(newStreak)
          try {
            localStorage.setItem(BEST_REIGN_KEY, String(newStreak))
          } catch {
            /* private mode / storage disabled */
          }
        }
        if (
          !recordBeatenRef.current &&
          reignStartBestRef.current >= 3 &&
          newStreak > reignStartBestRef.current
        ) {
          recordBeatenRef.current = true
          newBest = true
        }
        if (milestone || newBest) {
          if (!reduceMotion) setFlash((f) => f + 1)
          playMilestone()
        }
        if (newBest) {
          toast(`New best reign — ${newStreak} straight! 🔥`, 'info')
          posthog.capture('battle_reign_best', { streak: newStreak })
        }

        const np = res.nextPair
        const champSkin = np.a.skinId === winnerId ? np.a : np.b
        const challenger = np.a.skinId === winnerId ? np.b : np.a
        const newCurrent: BattlePair =
          winnerSide === 'a'
            ? { token: np.token, a: champSkin, b: challenger }
            : { token: np.token, a: challenger, b: champSkin }
        setView((prev) => ({
          ...prev,
          current: newCurrent,
          next: null,
          feedback: res.feedback,
          stats: res.stats,
        }))
        setPickedSide(null)
        onVoted(res)
      } catch (err) {
        // The reign is committed only on success (above), so a failed pick never
        // touched it — keep it. Only a genuinely DEAD matchup (expired / already
        // counted / invalid token) forces a re-deal, which ends the reign; every
        // other failure — rate limit, a flaky network blip, a timeout from
        // mashing a side — is transient, so keep the reign AND the live matchup
        // (its nonce wasn't burned) and just nudge them to ease off, then let
        // them re-pick.
        setSession((s) => s - 1)
        setPickedSide(null)
        const msg = err instanceof Error ? err.message : ''
        if (/expired|already counted|refresh|not part of|malformed/i.test(msg)) {
          toast(msg || 'That matchup expired — here come fresh ones.', 'error')
          await resync()
        } else {
          toast(
            /slow down|limit/i.test(msg)
              ? msg
              : "Whoa there, buckaroo — easy on the trigger. Your reign's safe.",
            'info',
          )
        }
      } finally {
        busyRef.current = false
      }
    },
    [resync, reduceMotion, animateArena, arenaRef, posthog],
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
      // King-of-the-hill: restore the reign as it stood before the undone pick
      // (streak + which card carried the crown). canUndo is cleared on a mode
      // toggle, so the entry always matches the current mode.
      const champBefore = historyRef.current[0]?.championBefore
      if (champBefore) {
        setStreak(champBefore.streak)
        const cid = champBefore.championSkinId
        setChampionSide(
          cid
            ? res.pair.a.skinId === cid
              ? 'a'
              : res.pair.b.skinId === cid
                ? 'b'
                : null
            : null,
        )
      }
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

  // Switch loop modes WITHOUT disturbing play: the current matchup stays on
  // screen and the reign (streak/championSide) is kept in memory, so an
  // accidental flip — or a flip back — never ends a streak or deals a new
  // battle. The crown just hides while Shuffle is active; toggling back to
  // Champion resumes it. A carried-over reign ends only when the next shuffle
  // pick deals a fresh pair (see pick()).
  const setBattleMode = useCallback((next: BattleMode) => {
    if (busyRef.current || next === modeRef.current) return
    setMode(next)
    setPickedSide(null)
    setCanUndo(false)
    // Champion mode prefetches nothing; entering Shuffle needs a next pair ready
    // for the first pick, dealt in the background without touching the matchup.
    if (next === 'shuffle' && !viewRef.current.next) {
      void (async () => {
        try {
          const s = await fetchQuickBattle({
            data: { restoreToken: guestRestoreToken() },
          })
          rememberGuestToken(s.guestToken)
          setView((prev) => (prev.next ? prev : { ...prev, next: s.pair }))
        } catch {
          /* the first shuffle pick recovers via resync if a next is still missing */
        }
      })()
    }
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      try {
        localStorage.setItem('sb_battle_muted', next ? '1' : '0')
      } catch {
        /* private mode / storage disabled - the toggle still works in-session */
      }
      if (!next) initAudio()
      return next
    })
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
  // (Still used by the VS badge below.)
  const entrance: Entrance =
    pickedSide !== null
      ? 'settled'
      : picksMadeRef.current === 0
        ? 'reveal'
        : 'round'
  // Per-card entrance: only a freshly dealt skin animates in. A card whose skin
  // was already on screen last render stays put — the reigning champion between
  // rounds, and both cards after a mode toggle that keeps the matchup.
  const cardEntrance = (side: 'a' | 'b'): Entrance => {
    if (pickedSide !== null) return 'settled'
    const skinId = side === 'a' ? current.a.skinId : current.b.skinId
    if (prevSkinsRef.current.has(skinId)) return 'settled'
    return picksMadeRef.current === 0 ? 'reveal' : 'round'
  }

  // Arena controls reused by both the page header and the theater header.
  const modeToggle = (
    <div className="flex shrink-0 items-center overflow-hidden bg-hextech-black/70 outline outline-icon/30 -outline-offset-1">
      {(
        [
          ['shuffle', faShuffle, 'Shuffle', 'A fresh pair every round'],
          ['champion', faCrown, 'Champion', 'The winner stays on — king of the hill'],
        ] as const
      ).map(([m, icon, label, title]) => (
        <button
          key={m}
          type="button"
          onClick={() => setBattleMode(m)}
          aria-pressed={mode === m}
          title={title}
          className={`flex h-8 cursor-pointer items-center gap-1.5 px-2.5 text-xs font-bold uppercase tracking-[0.1em] transition duration-150 ${
            mode === m ? 'bg-gold5/30 text-gold1' : 'text-grey1 hover:text-gold1'
          }`}
        >
          <FontAwesomeIcon icon={icon} className="h-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
  const muteButton = (
    <button
      type="button"
      onClick={toggleMute}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      title={muted ? 'Unmute' : 'Mute'}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center bg-hextech-black/70 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2"
    >
      <FontAwesomeIcon
        icon={muted ? faVolumeXmark : faVolumeHigh}
        className="h-3.5"
      />
    </button>
  )
  // Your slice next to the room: session this visit, your lifetime, the
  // community total. Sits inline on the toolbar, left of the utility icons.
  const statsLine = (
    <p className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-grey1">
      {session > 0 && (
        <span className="flex items-center gap-1.5 font-bold text-gold2">
          <FontAwesomeIcon icon={faFire} className="h-3.5" />
          <span className="tabular-nums">
            <AnimatedCount value={session} /> this session
          </span>
        </span>
      )}
      {mode === 'champion' && bestReign > 0 && (
        <span
          className="flex items-center gap-1.5"
          title="Your longest reign (saved on this device)"
        >
          <FontAwesomeIcon icon={faTrophy} className="h-3.5 text-gold2" />
          <span className="tabular-nums">
            <b className="text-gold1">
              <AnimatedCount value={bestReign} />
            </b>{' '}
            best reign
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
  )

  // One arena, two stages: the same cards render into the normal page flow or
  // into the theater overlay. Each card is keyed by its skin id, so in shuffle
  // both remount per pair (entrance plays) while in champion the reigning card
  // keeps its mount and only the challenger swaps. The VS badge lives OUTSIDE
  // the grid so it persists across rounds - it slams once at the reveal, then
  // only pulses (inner span, keyed per pair) as each new matchup lands. Both
  // moves are transform/opacity-only; the glow is static (.vs-glow).
  const arena = (
    <div ref={arenaRef} className="relative w-full">
      <div
        className={`grid w-full grid-cols-1 md:grid-cols-2 ${
          theater ? 'gap-2 md:gap-3' : 'gap-3 md:gap-4'
        }`}
      >
        <BattleCard
          key={current.a.skinId}
          skin={current.a}
          side="a"
          verdict={pickedSide ? (pickedSide === 'a' ? 'winner' : 'loser') : null}
          isChampion={mode === 'champion' && championSide === 'a'}
          streak={streak}
          onPick={pick}
          onBroken={broken}
          entrance={cardEntrance('a')}
        />
        <BattleCard
          key={current.b.skinId}
          skin={current.b}
          side="b"
          verdict={pickedSide ? (pickedSide === 'b' ? 'winner' : 'loser') : null}
          isChampion={mode === 'champion' && championSide === 'b'}
          streak={streak}
          onPick={pick}
          onBroken={broken}
          entrance={cardEntrance('b')}
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
      <header className="animate-fade-up mb-5">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Endless · which do you like more?
        </p>
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
          Head-to-Head
        </h1>
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
            <div className="flex shrink-0 items-center gap-1.5">
              {modeToggle}
              {muteButton}
              <button
                onClick={() => setTheater(false)}
                aria-label="Exit theater mode"
                title="Exit theater (Esc)"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center bg-hextech-black/60 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2"
              >
                <FontAwesomeIcon icon={faCompress} className="h-4" />
              </button>
            </div>
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
          {/* Arena toolbar: the mode choice sits on the left, right above the
              matchup it governs; the stats line + utility controls (keyboard
              hint, mute, theater) cluster on the right. The extra bottom margin
              leaves headroom for a champion's flames to lick up; z-20 keeps the
              controls legible in front of any flames that reach this high. */}
          <div className="relative z-20 mb-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {modeToggle}
            <div className="flex flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {statsLine}
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  title="← and → to vote"
                  aria-label="Keyboard: left and right arrow keys vote"
                  className="hidden h-8 w-8 cursor-help items-center justify-center bg-hextech-black/70 text-grey1 outline outline-icon/30 -outline-offset-1 md:flex"
                >
                  <FontAwesomeIcon icon={faKeyboard} className="h-3.5 text-gold2/80" />
                </span>
                {muteButton}
                <button
                  onClick={() => setTheater(true)}
                  aria-label="Enter theater mode"
                  title="Theater mode"
                  className="flex h-8 w-8 cursor-pointer items-center justify-center bg-hextech-black/70 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2"
                >
                  <FontAwesomeIcon icon={faExpand} className="h-3.5" />
                </button>
              </div>
            </div>
          </div>
          {arena}
          <FeedbackBar feedback={feedback} />
          <Standing feedback={feedback} />
          <ConsensusCallout feedback={feedback} />
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
          community ranking for now;{' '}
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
      <TodayStrip hub={hub} current="head-to-head" />

      {/* Preload the next pair's splashes while the current one is on screen
          - by the time it's dealt in, both images are already decoded. A
          preload that 403s gets its pair replaced before it's ever shown.
          Shuffle only: champion deals its challenger from the vote response,
          so there's no next pair to preload ahead of the pick. */}
      {mode === 'shuffle' && view.next && (
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

      {/* Milestone gold wash: a brief screen-wide bloom on every 3rd defence
          (champion mode). Above the theater overlay (z-85); keyed on `flash`
          so it replays. Its peak opacity scales with the streak so deeper
          milestones land bigger. Opacity-only fade, gated by reduced motion. */}
      {flash > 0 && !reduceMotion && (
        <motion.div
          key={flash}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[90]"
          initial={{ opacity: 0.42 + Math.min(streak, 30) * 0.009 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          style={{
            background:
              'radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--color-gold2) 40%, transparent), transparent 62%)',
          }}
        />
      )}
    </div>
  )
}
