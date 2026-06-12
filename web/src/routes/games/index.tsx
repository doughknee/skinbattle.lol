import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faCheck,
  faCoins,
  faFire,
  faImage,
  faLock,
  faPalette,
  faRankingStar,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import ErrorState from '~/components/ErrorState'
import { fetchDailyHub } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import type { HubGame } from '~/lib/games/types'

export const Route = createFileRoute('/games/')({
  // Data loads BEFORE the route renders (SSR on first visit, prefetched on
  // navigation) — the page arrives complete, no loading states to decorate.
  loader: () => fetchDailyHub({ data: { restoreToken: guestRestoreToken() } }),
  head: () => ({
    meta: [
      { title: 'Games — Skin Battle' },
      ...ogMeta({
        title: 'Daily Skin Games — Skin Battle',
        description:
          'Splashdle, Quick Battle, and the Mirror — daily challenges for League skin connoisseurs. Free, no account needed.',
        card: 'games',
        path: '/games',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load today's games" message={error.message} />
  ),
  component: GamesHubPage,
})

// The Daily Hub: every daily game on one page with a unified "today"
// checklist. More games (Quick Battle, Price Check, Chroma Vision) slot in
// alongside Splashdle as they ship.

const cardShell =
  'bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-6'

function statusChip(game: HubGame) {
  switch (game.status) {
    case 'won':
      return (
        <span className="flex items-center gap-1.5 bg-gold5/30 px-3 py-1 text-sm font-bold text-gold1 outline outline-gold2/60 -outline-offset-1">
          <FontAwesomeIcon icon={faCheck} className="h-3.5" />
          Solved {game.guessesUsed}/{game.maxGuesses}
        </span>
      )
    case 'lost':
      return (
        <span className="bg-red-950/40 px-3 py-1 text-sm font-bold text-red-300 outline outline-red-400/40 -outline-offset-1">
          Out of guesses
        </span>
      )
    case 'in_progress':
      return (
        <span className="bg-blue5/60 px-3 py-1 text-sm font-bold text-blue1 outline outline-blue3 -outline-offset-1">
          In progress · {game.guessesUsed}/{game.maxGuesses}
        </span>
      )
    default:
      return (
        <span className="bg-hextech-black/40 px-3 py-1 text-sm font-bold text-gold2 outline outline-gold5/60 -outline-offset-1">
          Play today's
        </span>
      )
  }
}

function SplashdleCard({ game }: { game: HubGame }) {
  return (
    <Link
      to="/games/splashdle"
      className={`${cardShell} group flex flex-col gap-4 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
            <FontAwesomeIcon icon={faImage} className="h-6 text-gold2" />
          </div>
          <div>
            <h3 className="font-serif text-2xl font-bold text-gold1 group-hover:text-gold2 transition duration-150">
              Splashdle
            </h3>
            <p className="text-sm text-grey1">
              Name the skin from a sliver of its splash. It zooms out with
              every miss — six guesses.
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {statusChip(game)}
        {game.streak.current > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1 text-sm font-bold text-gold2 outline outline-icon/30 -outline-offset-1">
            <FontAwesomeIcon icon={faFire} className="h-3.5" />
            {game.streak.current}-day streak
          </span>
        )}
        {game.streak.best > 1 && (
          <span className="text-sm text-grey1">Best: {game.streak.best}</span>
        )}
      </div>
    </Link>
  )
}

// Quick Battle is endless rather than daily, so its card shows volume — your
// battles fought and the community's — instead of a checklist slot.
function QuickBattleCard({
  qb,
}: {
  qb: { userBattles: number; communityBattles: number }
}) {
  return (
    <Link
      to="/games/quick-battle"
      className={`${cardShell} group flex flex-col gap-4 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
            <FontAwesomeIcon icon={faShuffle} className="h-6 text-gold2" />
          </div>
          <div>
            <h3 className="font-serif text-2xl font-bold text-gold1 group-hover:text-gold2 transition duration-150">
              Quick Battle
            </h3>
            <p className="text-sm text-grey1">
              Two skins. Pick one. The endless swipe that builds the rankings.
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-hextech-black/40 px-3 py-1 text-sm font-bold text-gold2 outline outline-gold5/60 -outline-offset-1">
          {qb.userBattles > 0
            ? `${qb.userBattles.toLocaleString()} battles fought`
            : 'Jump in'}
        </span>
        <span className="text-sm text-grey1">
          {qb.communityBattles.toLocaleString()} community battles
        </span>
      </div>
    </Link>
  )
}

// The Mirror is the read surface over Quick Battle's data: the loop feeds
// the mirror, the mirror sends you back into the loop.
function MirrorCard({ mirror }: { mirror: { skinsRated: number } }) {
  return (
    <Link
      to="/games/mirror"
      className={`${cardShell} group flex flex-col gap-4 transition duration-200 hover:-translate-y-0.5 hover:bg-hextech-black/50 hover:outline-gold2/60`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
            <FontAwesomeIcon icon={faRankingStar} className="h-6 text-gold2" />
          </div>
          <div>
            <h3 className="font-serif text-2xl font-bold text-gold1 group-hover:text-gold2 transition duration-150">
              The Mirror
            </h3>
            <p className="text-sm text-grey1">
              Your taste, reflected: the tier list your battles build, your
              hottest takes, your wardrobe.
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-hextech-black/40 px-3 py-1 text-sm font-bold text-gold2 outline outline-gold5/60 -outline-offset-1">
          {mirror.skinsRated > 0
            ? `${mirror.skinsRated.toLocaleString()} skins rated`
            : 'See what your picks reveal'}
        </span>
      </div>
    </Link>
  )
}

const upcoming: { name: string; blurb: string; icon: IconDefinition }[] = [
  {
    name: 'Price Check',
    blurb: 'Guess the RP tier. Legacy relics included.',
    icon: faCoins,
  },
  {
    name: 'Chroma Vision',
    blurb: 'Name the skin from its colors alone. Hard mode.',
    icon: faPalette,
  },
]

function GamesHubPage() {
  const hub = Route.useLoaderData()

  // Mirror the guest token to localStorage as a cookie backup.
  useEffect(() => {
    rememberGuestToken(hub.guestToken)
  }, [hub.guestToken])

  const done = hub.games.filter(
    (g) => g.status === 'won' || g.status === 'lost',
  ).length

  return (
    <div className="container mx-auto px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="A new puzzle every day"
        title={
          <>
            G<span className="italic">ames</span>
          </>
        }
        subtitle="Daily challenges for skin connoisseurs. No account needed — just play."
      />

      <section className="max-w-3xl">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl md:text-3xl font-bold text-gold2">
            Today's Challenges
          </h2>
          <span className="text-sm font-bold text-grey1">
            {done}/{hub.games.length} complete
          </span>
        </div>

        <div className="stagger flex flex-col gap-4">
          {hub.games.map((g) => (
            <SplashdleCard key={g.id} game={g} />
          ))}
        </div>
      </section>

      <section className="mt-16 max-w-3xl">
        <h2 className="mb-2 font-serif text-2xl font-bold text-gold2">
          Always open
        </h2>
        <p className="mb-6 text-grey1">
          No daily limit — battle as long as the picks feel easy.
        </p>
        <div className="stagger flex flex-col gap-4">
          <QuickBattleCard qb={hub.quickBattle} />
          <MirrorCard mirror={hub.mirror} />
        </div>
      </section>

      <section className="mt-16 max-w-3xl">
        <h2 className="mb-2 font-serif text-2xl font-bold text-gold2">
          On the way
        </h2>
        <p className="mb-6 text-grey1">
          The Daily Hub grows from here — one checklist, one share grid.
        </p>
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
          {upcoming.map((u) => (
            <div key={u.name} className={`${cardShell} opacity-60`}>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-hextech-black/60 outline outline-icon/30 -outline-offset-2">
                <FontAwesomeIcon icon={u.icon} className="h-4 text-icon" />
              </div>
              <h3 className="mb-1 flex items-center gap-2 font-serif text-lg font-bold text-gold1">
                {u.name}
                <FontAwesomeIcon icon={faLock} className="h-3 text-grey1" />
              </h3>
              <p className="text-sm text-grey1">{u.blurb}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
