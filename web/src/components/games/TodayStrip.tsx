import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatedNumber } from './AnimatedNumber'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowRight,
  faCheck,
  faCoins,
  faFire,
  faImage,
  faPalette,
} from '@fortawesome/free-solid-svg-icons'
import type { DailyHubState, HubGame } from '~/lib/games/types'

// The daily-challenges strip that lives below the Quick Battle arena on
// /battle - the old games hub, compacted. Battle is the door; this is the
// "also today" shelf: the three daily puzzles.

// Per-game card copy. Win/loss chip labels differ: Splashdle is
// guess-counted, Price Check is score-counted.
const GAME_CARDS: Record<
  HubGame['id'],
  {
    to: string
    name: string
    blurb: string
    icon: IconDefinition
    wonLabel: (g: HubGame) => string
    lostLabel: string
  }
> = {
  splashdle: {
    to: '/battle/splashdle',
    name: 'Splashdle',
    blurb: 'Name the skin from a sliver of its splash. Six guesses.',
    icon: faImage,
    wonLabel: (g) => `Solved ${g.guessesUsed}/${g.maxGuesses}`,
    lostLabel: 'Out of guesses',
  },
  'price-check': {
    to: '/battle/price-check',
    name: 'Price Check',
    blurb: 'Five skins. Guess what each one cost in RP.',
    icon: faCoins,
    wonLabel: (g) => `Scored ${g.score ?? 0}/${g.maxGuesses}`,
    lostLabel: 'Better luck tomorrow',
  },
  'chroma-vision': {
    to: '/battle/chroma-vision',
    name: 'Chroma Vision',
    blurb: 'Name the skin from its colors alone. Hard mode.',
    icon: faPalette,
    wonLabel: (g) => `Solved ${g.guessesUsed}/${g.maxGuesses}`,
    lostLabel: 'Out of guesses',
  },
}

// The streak hook - the honest motivation line. "Keep your N-day streak alive"
// shows ONLY when the streak is truthfully alive and today isn't done yet;
// otherwise it nudges toward starting one, celebrates a secured streak, or
// states a reset plainly. Lit gold flame = something live to keep; dim flame =
// nothing on the line yet. (Freeze tokens are intentionally never mentioned -
// the mechanic isn't wired, so it can't truthfully protect a streak.)
function streakHook(
  game: HubGame,
): { lit: boolean; pulse: boolean; text: string } | null {
  const { current, best } = game.streak
  if (game.status === 'won') {
    if (current <= 0) return null
    return {
      lit: true,
      pulse: false,
      text: current === 1 ? 'Streak started!' : `${current}-day streak secured`,
    }
  }
  if (game.status === 'lost') {
    return best > 0
      ? { lit: false, pulse: false, text: `Streak reset · best was ${best}` }
      : null
  }
  // Today isn't done yet (not_started or in_progress). The at-risk streak is
  // the only state that pulses - earned urgency, never decorative.
  if (game.streakAlive && current > 0) {
    return { lit: true, pulse: true, text: `Keep your ${current}-day streak alive` }
  }
  if (best > 0)
    return { lit: false, pulse: false, text: `Start a new streak · best ${best}` }
  return { lit: false, pulse: false, text: 'Start a streak today' }
}

function StreakHook({ game }: { game: HubGame }) {
  const hook = streakHook(game)
  if (!hook) return null
  return (
    <p
      className={`flex items-center gap-1.5 text-sm font-bold ${
        hook.lit ? 'text-gold1' : 'text-grey1'
      }`}
    >
      <FontAwesomeIcon
        icon={faFire}
        className={`h-3.5 ${hook.lit ? 'text-gold2' : 'text-icon/50'} ${
          hook.pulse ? 'animate-pulse' : ''
        }`}
      />
      {hook.text}
    </p>
  )
}

// The action affordance: a loud, inviting CTA when there's a puzzle to play,
// quiet and satisfied once today is done.
function ActionChip({
  game,
  card,
}: {
  game: HubGame
  card: (typeof GAME_CARDS)[HubGame['id']]
}) {
  switch (game.status) {
    case 'won':
      return (
        <span className="inline-flex items-center gap-1.5 bg-gold5/20 px-2.5 py-1 text-xs font-bold text-gold1 outline outline-gold2/40 -outline-offset-1">
          <FontAwesomeIcon icon={faCheck} className="h-3" />
          {card.wonLabel(game)}
        </span>
      )
    case 'lost':
      return (
        <span className="bg-danger-surface/30 px-2.5 py-1 text-xs font-bold text-danger/90 outline outline-danger-border/30 -outline-offset-1">
          {card.lostLabel} · back tomorrow
        </span>
      )
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-2 bg-blue5/60 px-3 py-1.5 text-sm font-bold text-blue1 outline outline-blue3 -outline-offset-1">
          Resume ·{' '}
          {game.id === 'price-check'
            ? `${game.score ?? 0} right`
            : `${game.guessesUsed}/${game.maxGuesses}`}
          <FontAwesomeIcon icon={faArrowRight} className="h-3" />
        </span>
      )
    default:
      // not_started - the loud CTA, the brightest thing on the card.
      return (
        <span className="inline-flex items-center gap-2 bg-gold5/30 px-3 py-1.5 text-sm font-bold text-gold1 outline outline-gold2 -outline-offset-1 transition duration-150 group-hover:bg-gold5/45">
          Play today's
          <FontAwesomeIcon
            icon={faArrowRight}
            className="h-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </span>
      )
  }
}

// Full-width banner; loudness driven by status. A fresh daily is a lit,
// ember-bedded card that rakes gold on hover and lifts; one in progress is a
// warm blue "resume"; a finished one drops to a flat, glow-less receipt (and is
// sorted to the bottom by the strip). Each gets room to breathe in one column.
function DailyCard({ game, index }: { game: HubGame; index: number }) {
  const card = GAME_CARDS[game.id]
  const done = game.status === 'won' || game.status === 'lost'
  const won = game.status === 'won'
  const fresh = game.status === 'not_started'
  const shell = fresh
    ? 'card-sheen-host battle-idle border-l-2 border-l-gold5 bg-hextech-black/40 outline-gold2/40 hover:-translate-y-0.5 hover:bg-hextech-black/55 hover:outline-gold2 hover:shadow-glow'
    : game.status === 'in_progress'
      ? 'card-sheen-host border-l-2 border-l-blue3 bg-hextech-black/40 outline-blue3/40 hover:-translate-y-0.5 hover:outline-blue3 hover:shadow-glow'
      : 'bg-hextech-black/20 outline-icon/15'
  return (
    <Link
      to={card.to}
      className={`group relative flex items-center gap-4 overflow-hidden p-5 outline -outline-offset-2 transition duration-200 ${shell}`}
    >
      {/* Always-on ember bed only on fresh dailies - the "come play me" energy,
          kept off in-progress/done so the eye lands on what's untouched. */}
      {fresh && (
        // Offset the whole ember bed per card so two or three open dailies
        // don't rise in lockstep - negative net delays start each mid-cycle.
        <span
          className="battle-embers"
          aria-hidden
          style={{ '--ember-card-delay': `${0.5 + index * 1.2}s` } as CSSProperties}
        >
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
      {!done && <span className="card-sheen" aria-hidden />}
      <div
        className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline -outline-offset-2 ${
          done ? 'outline-icon/25' : 'outline-gold5/60'
        }`}
      >
        <FontAwesomeIcon
          icon={card.icon}
          className={`h-6 ${done ? 'text-grey1' : 'text-gold2'}`}
        />
        {/* Unmistakable "you finished today's" mark on completed cards - gold
            for a win, muted for a loss (still done, just not a win). */}
        {done && (
          <span
            className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-hextech-black outline outline-2 -outline-offset-1 ${
              won ? 'text-gold1 outline-gold2' : 'text-grey1 outline-icon/40'
            }`}
          >
            <FontAwesomeIcon icon={faCheck} className="h-3" />
          </span>
        )}
      </div>
      <div className="relative min-w-0 flex-1">
        <h3
          className={`font-serif text-xl font-bold transition duration-150 md:text-2xl ${
            done ? 'text-grey1' : 'text-gold1 group-hover:text-gold2'
          }`}
        >
          {card.name}
        </h3>
        <p className="truncate text-sm text-grey1">{card.blurb}</p>
      </div>
      <div className="relative flex shrink-0 flex-col items-end gap-2 text-right">
        <StreakHook game={game} />
        <ActionChip game={game} card={card} />
      </div>
    </Link>
  )
}

// ── Live countdown to the next daily drop (midnight UTC) ──────────────────
function msToNextUtcMidnight(now: number): number {
  const d = new Date(now)
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  return Math.max(0, next - now)
}

// Two-digit, zero-padded animated unit (Motion+ AnimateNumber rolls each digit
// on change). format keeps it to "07" rather than "7".
function Unit({ value }: { value: number }) {
  return <AnimatedNumber value={value} format={{ minimumIntegerDigits: 2 }} />
}

// Client-only + SSR-safe: a static placeholder until mounted (so the server and
// first client paint match), then ticks every second. AnimateNumber is a
// client-only Motion+ component, so it never renders during SSR. The reset is
// midnight UTC (matches utcToday on the server).
function Countdown() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (now === null) {
    return <span className="tabular-nums text-gold1">--:--:--</span>
  }
  const total = Math.floor(msToNextUtcMidnight(now) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return (
    <span className="inline-flex items-center tabular-nums text-gold1">
      <Unit value={h} />
      <span className="text-gold2/60">:</span>
      <Unit value={m} />
      <span className="text-gold2/60">:</span>
      <Unit value={s} />
    </span>
  )
}

export default function TodayStrip({ hub }: { hub: DailyHubState }) {
  const done = hub.games.filter(
    (g) => g.status === 'won' || g.status === 'lost',
  ).length
  const total = hub.games.length
  // Active dailies first (resume what you started, then fresh ones); finished
  // ones fall to the bottom. Array.sort is stable, so each group keeps order.
  const rank = (s: HubGame['status']) =>
    s === 'in_progress' ? 0 : s === 'not_started' ? 1 : 2
  const orderedGames = [...hub.games].sort(
    (a, b) => rank(a.status) - rank(b.status),
  )

  return (
    <section className="mt-16">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="font-serif text-2xl font-bold text-gold2">
          Today's battles
        </h2>
        <p className="flex items-center gap-2 text-sm font-bold text-grey1">
          {done > 0 && (
            <>
              <span className={done === total ? 'text-gold1' : undefined}>
                {done === total ? `All ${total} done` : `${done}/${total} done`}
              </span>
              <span aria-hidden className="text-icon/40">
                ·
              </span>
            </>
          )}
          <span>Next puzzles in</span>
          <Countdown />
        </p>
      </div>
      <div className="stagger flex flex-col gap-3">
        {orderedGames.map((g, i) => (
          <DailyCard key={g.id} game={g} index={i} />
        ))}
      </div>
    </section>
  )
}
