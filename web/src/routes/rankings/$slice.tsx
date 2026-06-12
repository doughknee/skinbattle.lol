import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faFlaskVial,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fetchRankings } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import type { RankingRow } from '~/lib/games/types'

export const Route = createFileRoute('/rankings/$slice')({
  loader: async ({ params }) => {
    const state = await fetchRankings({ data: { slice: params.slice } })
    if (!state) throw notFound()
    return state
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — Skin Battle` },
          {
            name: 'description',
            content: `${loaderData.subtitle} ${loaderData.ratedCount} of ${loaderData.totalCount} rated so far.`,
          },
          ...ogMeta({
            title: `${loaderData.title} — Skin Battle`,
            description: loaderData.subtitle,
            imagePath: `/og/rankings/${loaderData.slice}`,
            path: `/rankings/${loaderData.slice}`,
          }),
        ]
      : [{ title: 'Rankings — Skin Battle' }],
  }),
  notFoundComponent: () => (
    <ErrorState
      title="No such slice"
      message="That ranking slice doesn't exist — browse the index for every price tier, line, champion, and year."
      retry={false}
      back={{ to: '/rankings', label: 'All rankings' }}
    />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load this ranking" message={error.message} />
  ),
  component: RankingSlicePage,
})

function Row({ row }: { row: RankingRow }) {
  return (
    <li className="flex items-center gap-4 bg-hextech-black/30 p-3 outline outline-icon/10 -outline-offset-1">
      <span className="w-9 shrink-0 text-right font-serif text-sm font-bold text-grey1">
        #{row.rank}
      </span>
      <Link
        to="/skins/$slug"
        params={{ slug: row.slug }}
        className="shrink-0 outline outline-icon/20 -outline-offset-1 transition duration-150 hover:outline-gold2"
      >
        <img
          src={row.splashUrl}
          alt={row.name}
          loading="lazy"
          decoding="async"
          className="aspect-video w-20 object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif font-bold text-gold1">
          <Link
            to="/skins/$slug"
            params={{ slug: row.slug }}
            className="transition duration-150 hover:text-gold2"
          >
            {row.name}
          </Link>
        </p>
        <p className="truncate text-sm text-grey1">
          {row.championName}
          {row.cost !== null && <> · {row.cost.toLocaleString()} RP</>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-serif text-xl font-bold text-gold1">{row.rating}</p>
        <p className="text-xs text-grey1">
          ± {row.uncertainty} · {row.battles}{' '}
          {row.battles === 1 ? 'battle' : 'battles'}
        </p>
      </div>
    </li>
  )
}

function RankingSlicePage() {
  const state = Route.useLoaderData()

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <Link to="/rankings" className="transition duration-150 hover:text-gold1">
            Rankings
          </Link>
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {state.title}
        </h1>
        <p className="mt-2 text-grey1">{state.subtitle}</p>
      </header>

      {state.calibrating && (
        <p className="animate-fade-up mb-6 flex max-w-2xl items-baseline gap-2 bg-blue5/40 p-3 text-sm text-blue1 outline outline-blue3/60 -outline-offset-1">
          <FontAwesomeIcon icon={faFlaskVial} className="h-3.5 shrink-0 self-center" />
          <span>
            <b>Early Rankings — still calibrating.</b> {state.ratedCount} of{' '}
            {state.totalCount} skins rated, median{' '}
            {state.medianBattles} {state.medianBattles === 1 ? 'battle' : 'battles'}{' '}
            each. Every Quick Battle pick sharpens this list.
          </span>
        </p>
      )}

      {state.rows.length > 0 ? (
        <ol className="animate-fade-up flex flex-col gap-1.5">
          {state.rows.map((r) => (
            <Row key={r.skinId} row={r} />
          ))}
        </ol>
      ) : (
        <div className="animate-fade-up max-w-2xl bg-hextech-black/30 p-6 outline outline-icon/20 -outline-offset-2">
          <p className="text-grey1">
            None of these {state.totalCount.toLocaleString()} skins have been
            battled yet — this list is waiting for its first verdict.
          </p>
        </div>
      )}

      {state.ratedCount > state.rows.length && (
        <p className="mt-4 text-sm text-grey1">
          Showing the top {state.rows.length} of {state.ratedCount} rated skins.
        </p>
      )}
      {state.totalCount > state.ratedCount && state.ratedCount > 0 && (
        <p className="mt-2 text-sm text-grey1">
          {(state.totalCount - state.ratedCount).toLocaleString()} more skins in
          this slice await their first battle.
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link to="/games/quick-battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Battle to sharpen this list
        </Link>
        <Link to="/rankings" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          All rankings
        </Link>
      </div>
    </div>
  )
}
