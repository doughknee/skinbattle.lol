import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faCheck,
  faCoins,
  faFire,
  faImage,
  faPalette,
  faTrophy,
} from '@fortawesome/free-solid-svg-icons'
import type { DailyHubState, HubGame } from '~/lib/games/types'

// The daily-challenges strip that lives below the Quick Battle arena on
// /battle — the old games hub, compacted. Battle is the door; this is the
// "also today" shelf: three dailies, fresh patch skins, leaderboards.

const cardShell =
  'bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-5'

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
    blurb: 'Name the skin from a sliver of its splash — six guesses.',
    icon: faImage,
    wonLabel: (g) => `Solved ${g.guessesUsed}/${g.maxGuesses}`,
    lostLabel: 'Out of guesses',
  },
  'price-check': {
    to: '/battle/price-check',
    name: 'Price Check',
    blurb: 'Five skins — guess what each one cost in RP.',
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

function statusChip(game: HubGame) {
  const card = GAME_CARDS[game.id]
  switch (game.status) {
    case 'won':
      return (
        <span className="flex items-center gap-1.5 bg-gold5/30 px-2.5 py-1 text-xs font-bold text-gold1 outline outline-gold2/60 -outline-offset-1">
          <FontAwesomeIcon icon={faCheck} className="h-3" />
          {card.wonLabel(game)}
        </span>
      )
    case 'lost':
      return (
        <span className="bg-red-950/40 px-2.5 py-1 text-xs font-bold text-red-300 outline outline-red-400/40 -outline-offset-1">
          {card.lostLabel}
        </span>
      )
    case 'in_progress':
      return (
        <span className="bg-blue5/60 px-2.5 py-1 text-xs font-bold text-blue1 outline outline-blue3 -outline-offset-1">
          In progress · {game.guessesUsed}/{game.maxGuesses}
        </span>
      )
    default:
      return (
        <span className="bg-hextech-black/40 px-2.5 py-1 text-xs font-bold text-gold2 outline outline-gold5/60 -outline-offset-1">
          Play today's
        </span>
      )
  }
}

function DailyCard({ game }: { game: HubGame }) {
  const card = GAME_CARDS[game.id]
  return (
    <Link
      to={card.to}
      className={`${cardShell} group flex flex-col gap-3 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
          <FontAwesomeIcon icon={card.icon} className="h-5 text-gold2" />
        </div>
        <div className="min-w-0">
          <h3 className="font-serif text-xl font-bold text-gold1 transition duration-150 group-hover:text-gold2">
            {card.name}
          </h3>
          <p className="truncate text-sm text-grey1">{card.blurb}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {statusChip(game)}
        {game.streak.current > 0 && (
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-gold2 outline outline-icon/30 -outline-offset-1">
            <FontAwesomeIcon icon={faFire} className="h-3" />
            {game.streak.current}-day streak
          </span>
        )}
      </div>
    </Link>
  )
}

export default function TodayStrip({ hub }: { hub: DailyHubState }) {
  const done = hub.games.filter(
    (g) => g.status === 'won' || g.status === 'lost',
  ).length

  return (
    <>
      <section className="mt-16">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl font-bold text-gold2">
            Today's battles
          </h2>
          <span className="text-sm font-bold text-grey1">
            {done}/{hub.games.length} complete · resets midnight UTC
          </span>
        </div>
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-3">
          {hub.games.map((g) => (
            <DailyCard key={g.id} game={g} />
          ))}
        </div>
      </section>

      {hub.newSkins.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">
            New this patch
          </h2>
          <p className="mb-5 text-grey1">
            Fresh off the patch notes — unranked until you battle them.
          </p>
          <ul className="stagger flex flex-wrap gap-2">
            {hub.newSkins.map((s) => (
              <li
                key={s.skinId}
                title={`${s.name} — ${s.championName}`}
                className="relative w-36 overflow-hidden bg-hextech-black/60 outline outline-icon/20 -outline-offset-1 transition duration-150 hover:outline-gold2"
              >
                <Link to="/skins/$slug" params={{ slug: s.slug }}>
                  <img
                    src={s.splashUrl}
                    alt={s.name}
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full object-cover"
                  />
                  <span className="absolute left-1 top-1 bg-blue5/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue1 outline outline-blue3 -outline-offset-1">
                    {s.upcoming ? 'Upcoming' : 'New'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <Link
          to="/battle/leaderboards"
          className={`${cardShell} group flex items-center gap-4 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60`}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
            <FontAwesomeIcon icon={faTrophy} className="h-5 text-gold2" />
          </div>
          <div>
            <h3 className="font-serif text-xl font-bold text-gold1 transition duration-150 group-hover:text-gold2">
              Leaderboards
            </h3>
            <p className="text-sm text-grey1">
              Streaks, fastest daily solves, and battle volume — the named
              players.
            </p>
          </div>
        </Link>
      </section>
    </>
  )
}
