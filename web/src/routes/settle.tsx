import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlaskVial, faShuffle } from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { btnChip, btnPrimarySm } from '~/lib/ui'
import { fetchSettleHub } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import { robotsMeta } from '~/lib/games/seo'
import { MAX_CONFIDENT_UNCERTAINTY } from '~/lib/games/answer'
import { readSessionBattles } from '~/lib/games/settle'
import type { SettleRow } from '~/lib/games/types'

// The participation hub: which champion rankings still need people, by the
// same two bars every champion page judges itself with. A routing page, not
// a landing page - it is noindexed, it lives outside the site map, and every
// row hands the visitor to a scoped battle (/battle?champion=<id>). The
// wording is the model's own numbers: a band against the published bar and a
// head count against the published floor, never a number of votes to go.

export const Route = createFileRoute('/settle')({
  loader: () => fetchSettleHub(),
  head: () => {
    const title = 'Rankings that need you | SkinBattle'
    const description =
      'Which champion skin rankings are still provisional, and where a few battles would settle them.'
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        // A live worklist that reorders with every vote: nothing stable to
        // index, and the champion pages are the canonical surfaces anyway.
        ...robotsMeta(false),
        ...ogMeta({ title, description, card: 'games', path: '/settle' }),
      ],
    }
  },
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the rankings" message={error.message} />
  ),
  component: SettlePage,
})

const PAGE = 24

const n = (v: number) => v.toLocaleString('en-US')

// What the leader still lacks, in the model's own terms.
function detail(row: SettleRow): string {
  const l = row.leader
  if (!l) return `${n(row.total)} ${row.total === 1 ? 'skin' : 'skins'}, none battled yet.`
  if (row.missing === 'voters') {
    return `${l.name} leads at ±${n(l.band)}, but only ${n(l.voters)} ${
      l.voters === 1 ? 'person has' : 'people have'
    } voted on it. A settled placing needs more separate voters, counting a signed-out visitor as half.`
  }
  return `${l.name} leads at ±${n(l.band)} over ${n(l.battles)} ${
    l.battles === 1 ? 'battle' : 'battles'
  }. A placing settles once its band reaches ±${n(MAX_CONFIDENT_UNCERTAINTY)}.`
}

function SettlePage() {
  const { rows, counts } = Route.useLoaderData()
  const posthog = usePostHog()
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? rows : rows.slice(0, PAGE)

  useEffect(() => {
    posthog?.capture('ranking_viewed', {
      page_type: 'settle',
      champion: null,
      ranking_state: null,
      session_battles: readSessionBattles(),
    })
    // Once per visit to the hub.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Help settle
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          Rankings that need you
        </h1>
        <p className="mt-3 max-w-2xl text-grey1">
          {n(counts.provisional)} of {n(counts.champions)} champion rankings are
          still provisional and {n(counts.empty)}{' '}
          {counts.empty === 1 ? 'has' : 'have'} no battles at all; {n(counts.settled)}{' '}
          {counts.settled === 1 ? 'is' : 'are'} settled. Pick a champion and every
          battle you fight adds evidence to that ranking.{' '}
          <Link
            to="/methodology"
            className="text-gold2 underline underline-offset-2 transition duration-150 hover:text-gold1"
          >
            How a ranking settles
          </Link>
        </p>
      </header>

      <ol className="stagger flex flex-col gap-3">
        {shown.map((row) => (
          <li
            key={row.championId}
            className="flex flex-col gap-4 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-1 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  to="/champions/$id"
                  params={{ id: row.championId.toLowerCase() }}
                  className="font-serif text-xl font-bold text-gold1 transition duration-150 hover:text-gold2"
                >
                  {row.championName}
                </Link>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-bold uppercase tracking-wider outline -outline-offset-1 ${
                    row.state === 'provisional'
                      ? 'bg-blue5/30 text-blue1 outline-blue3/50'
                      : 'bg-hextech-black/40 text-grey1 outline-icon/25'
                  }`}
                >
                  <FontAwesomeIcon icon={faFlaskVial} className="h-3" />
                  {row.state === 'provisional'
                    ? row.missing === 'voters'
                      ? 'Needs more voters'
                      : 'Top spot provisional'
                    : 'No battles yet'}
                </span>
                <span className="text-xs text-grey1">
                  {n(row.rated)} of {n(row.total)} rated
                </span>
              </div>
              <p className="mt-1.5 text-sm text-grey1">{detail(row)}</p>
            </div>
            <Link
              to="/battle"
              search={{ champion: row.slug }}
              onClick={() =>
                posthog?.capture('settle_cta_clicked', {
                  page_type: 'settle',
                  champion: row.slug,
                  ranking_state: row.state,
                  cta: 'battle',
                })
              }
              className={`${btnPrimarySm} w-full sm:w-auto`}
            >
              <FontAwesomeIcon icon={faShuffle} className="h-4" />
              Help settle
            </Link>
          </li>
        ))}
      </ol>

      {rows.length > PAGE && !showAll && (
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => setShowAll(true)} className={btnChip}>
            Show all {n(rows.length)}
          </button>
        </div>
      )}
      {rows.length === 0 && (
        <p className="text-grey1">
          Every champion ranking is settled. That has never happened; if you are
          reading this, go argue with one on the{' '}
          <Link
            to="/champions"
            className="text-gold2 underline underline-offset-2 hover:text-gold1"
          >
            champion pages
          </Link>
          .
        </p>
      )}
    </div>
  )
}
