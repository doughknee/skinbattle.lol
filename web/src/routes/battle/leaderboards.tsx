import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faFire,
  faTrophy,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import ErrorState from '~/components/ErrorState'
import { btnSecondarySm } from '~/lib/ui'
import { useAuth } from '~/lib/useAuth'
import { fetchLeaderboards } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import type { GameId } from '~/lib/games/types'

export const Route = createFileRoute('/battle/leaderboards')({
  loader: () => fetchLeaderboards(),
  head: () => ({
    meta: [
      { title: 'Leaderboards — Skin Battle' },
      {
        name: 'description',
        content:
          'Streaks, fastest daily solves, and battle volume — the named players of Skin Battle.',
      },
      ...ogMeta({
        title: 'Leaderboards — Skin Battle',
        description:
          'Streaks, fastest daily solves, and battle volume — the named players of Skin Battle.',
        card: 'leaderboards',
        path: '/battle/leaderboards',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the leaderboards" message={error.message} />
  ),
  component: LeaderboardsPage,
})

const GAME_NAMES: Record<GameId, string> = {
  splashdle: 'Splashdle',
  'price-check': 'Price Check',
  'chroma-vision': 'Chroma Vision',
}

const medal = (rank: number) =>
  rank === 1 ? 'text-gold1' : rank === 2 ? 'text-gold2' : rank === 3 ? 'text-gold4' : 'text-grey1'

function Board({
  title,
  rows,
  empty,
}: {
  title: string
  rows: { rank: number; name: string; detail: ReactNode }[]
  empty: string
}) {
  return (
    <div className="flex flex-col bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2">
      <h3 className="mb-3 font-serif text-lg font-bold text-gold1">{title}</h3>
      {rows.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.rank} className="flex h-9 items-baseline gap-3 text-sm">
              <span className={`w-6 shrink-0 text-right font-serif font-bold ${medal(r.rank)}`}>
                {r.rank}
              </span>
              <span className="min-w-0 truncate font-bold text-gold1">{r.name}</span>
              <span className="ml-auto shrink-0 text-grey1">{r.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-grey1">{empty}</p>
      )}
    </div>
  )
}

function LeaderboardsPage() {
  const state = Route.useLoaderData()
  const { isAuthenticated, login } = useAuth()

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Community · named players only"
        title={
          <>
            Leaderbo<span className="italic">ards</span>
          </>
        }
        subtitle="Streaks, fastest solves, and battle volume. Guests can look — only signed-in players hold a spot."
        className="mb-8"
      />

      {!isAuthenticated && (
        <p className="animate-fade-up mb-10 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 bg-gold5/10 p-4 text-sm text-grey1 outline outline-gold2/40 -outline-offset-2">
          <span>
            <FontAwesomeIcon icon={faTrophy} className="mr-2 h-3.5 text-gold2" />
            {state.memberCount > 0 ? (
              <>
                <b className="text-gold1">{state.memberCount}</b> named{' '}
                {state.memberCount === 1 ? 'player holds' : 'players hold'} the
                boards. Your guest streaks and battles join the moment you sign
                in.
              </>
            ) : (
              <>
                The boards are empty — be the first name on them. Your guest
                progress attaches the moment you sign in.
              </>
            )}
          </span>
          <button
            onClick={login}
            className="font-bold text-gold2 transition duration-150 hover:text-gold1"
          >
            Sign in →
          </button>
        </p>
      )}

      <section className="animate-fade-up">
        <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">
          Today's solves
        </h2>
        <p className="mb-4 text-sm text-grey1">
          Fewest guesses wins; ties go to the earlier solve. Resets midnight UTC.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {state.todayBoards.map((b) => (
            <Board
              key={b.game}
              title={GAME_NAMES[b.game]}
              rows={b.entries.map((e) => ({
                rank: e.rank,
                name: e.name,
                detail: `solved in ${e.guesses}/6`,
              }))}
              empty="No named solves yet today."
            />
          ))}
        </div>
      </section>

      <section className="animate-fade-up mt-12">
        <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">
          Streaks
        </h2>
        <p className="mb-4 text-sm text-grey1">
          Consecutive days won, per daily. Best streak breaks ties.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {state.streakBoards.map((b) => (
            <Board
              key={b.game}
              title={GAME_NAMES[b.game]}
              rows={b.entries.map((e) => ({
                rank: e.rank,
                name: e.name,
                detail: (
                  <>
                    <FontAwesomeIcon icon={faFire} className="mr-1 h-3 text-gold2" />
                    {e.current} · best {e.best}
                  </>
                ),
              }))}
              empty="No streaks on the board yet."
            />
          ))}
        </div>
      </section>

      <section className="animate-fade-up mt-12">
        <h2 className="mb-1 font-serif text-2xl font-bold text-gold2">
          Battle volume
        </h2>
        <p className="mb-4 text-sm text-grey1">
          Quick Battle verdicts delivered — every one sharpens the rankings.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {state.battleBoards.map((b) => (
            <Board
              key={b.period}
              title={b.period === 'week' ? 'This week' : 'All time'}
              rows={b.entries.map((e) => ({
                rank: e.rank,
                name: e.name,
                detail: `${e.battles.toLocaleString()} battles`,
              }))}
              empty="No member battles in this window yet."
            />
          ))}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Link to="/battle" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          Back to the battle
        </Link>
      </div>
    </div>
  )
}
