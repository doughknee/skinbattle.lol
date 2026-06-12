import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faChartLine,
  faCircleInfo,
  faRankingStar,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fetchSkinPage } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'

export const Route = createFileRoute('/skins_/$slug')({
  // Stable URLs, immutable key: any slug whose trailing ID resolves gets
  // redirected to the canonical spelling — old links survive renames.
  loader: async ({ params }) => {
    const state = await fetchSkinPage({
      data: { slug: params.slug, restoreToken: guestRestoreToken() },
    })
    if (!state) throw notFound()
    if (state.slug !== params.slug) {
      throw redirect({
        to: '/skins/$slug',
        params: { slug: state.slug },
        statusCode: 301,
      })
    }
    return state
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.name} — Skin Battle` },
          {
            name: 'description',
            content: `${loaderData.name} (${loaderData.championName}): community rating, rank, and price facts on Skin Battle.`,
          },
          ...ogMeta({
            title: `${loaderData.name} — Skin Battle`,
            description: loaderData.community
              ? `Rated ${loaderData.community.rating} ± ${loaderData.community.uncertainty} · #${loaderData.community.rank} of ${loaderData.ratedTotal} · ${loaderData.community.battles} battles`
              : 'Unranked — no battles fought yet. Be the first.',
            imagePath: `/og/skin/${loaderData.skinId}`,
            path: `/skins/${loaderData.slug}`,
          }),
        ]
      : [{ title: 'Skin — Skin Battle' }],
  }),
  notFoundComponent: () => (
    <ErrorState
      title="No such skin"
      message="That link doesn't resolve to a skin in the catalog."
      retry={false}
      back={{ to: '/skins', label: 'Browse skins' }}
    />
  ),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load this skin" message={error.message} />
  ),
  component: SkinPage,
})

const card =
  'bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-5 flex flex-col gap-1.5'

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

function SkinPage() {
  const state = Route.useLoaderData()

  useEffect(() => {
    rememberGuestToken(state.guestToken)
  }, [state.guestToken])

  const c = state.community
  const winRate =
    c && c.battles > 0 ? Math.round((100 * c.wins) / c.battles) : null

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <Link
            to="/champions/$id"
            params={{ id: state.championId }}
            className="transition duration-150 hover:text-gold1"
          >
            {state.championName}
          </Link>
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {state.name}
        </h1>
      </header>

      <div className="animate-fade-up relative aspect-video w-full overflow-hidden bg-hextech-black/60 outline outline-icon/20 -outline-offset-2">
        <img
          src={state.splashUrl}
          alt={`${state.name} splash art`}
          loading="eager"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>

      <section className="stagger mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={card}>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gold2">
            <FontAwesomeIcon icon={faRankingStar} className="h-3.5" />
            Community
          </p>
          {c ? (
            <>
              <p className="font-serif text-3xl font-bold text-gold1">
                {c.rating} <span className="text-lg text-grey1">± {c.uncertainty}</span>
              </p>
              <p className="text-sm text-grey1">
                #{c.rank} of {state.ratedTotal.toLocaleString()} rated ·{' '}
                {c.battles} battles
                {winRate !== null && <> · {winRate}% won</>}
              </p>
              {!c.calibrated && (
                <p className="text-sm text-blue2">
                  Early ranking — needs more votes.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-serif text-3xl font-bold text-grey1">
                Unranked
              </p>
              <p className="text-sm text-grey1">
                No battles fought yet — be the first.
              </p>
            </>
          )}
        </div>

        <div className={card}>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gold2">
            <FontAwesomeIcon icon={faChartLine} className="h-3.5" />
            Your take
          </p>
          {state.personal ? (
            <>
              <p className="font-serif text-3xl font-bold text-gold1">
                {state.personal.rating}
              </p>
              <p className="text-sm text-grey1">
                from {state.personal.battles}{' '}
                {state.personal.battles === 1 ? 'battle' : 'battles'} of yours
                {state.personal.gap !== null && Math.abs(state.personal.gap) >= 50 && (
                  <>
                    {' '}
                    ·{' '}
                    <b className={state.personal.gap > 0 ? 'text-blue2' : 'text-red-300'}>
                      {state.personal.gap > 0 ? '+' : '−'}
                      {Math.abs(state.personal.gap)} vs the room
                    </b>
                  </>
                )}
              </p>
              <Link
                to="/games/mirror"
                className="text-sm font-bold text-gold2 transition duration-150 hover:text-gold1"
              >
                See your full Mirror →
              </Link>
            </>
          ) : (
            <>
              <p className="font-serif text-3xl font-bold text-grey1">—</p>
              <p className="text-sm text-grey1">
                You haven't battled this skin yet. It might come up in Quick
                Battle.
              </p>
            </>
          )}
        </div>

        <div className={card}>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gold2">
            <FontAwesomeIcon icon={faCircleInfo} className="h-3.5" />
            Facts
          </p>
          {state.facts ? (
            <div className="flex flex-col gap-1 text-sm text-grey1">
              {state.facts.cost !== null && (
                <p>
                  <b className="text-gold1">
                    {state.facts.cost.toLocaleString()} RP
                  </b>
                  {state.facts.availability === 'Legacy' && (
                    <span> · Legacy vault — not even buyable anymore</span>
                  )}
                </p>
              )}
              {state.facts.release && <p>Released {fmtDate(state.facts.release)}</p>}
              {state.facts.sets.filter((s) => s !== 'Legacy').length > 0 && (
                <p>
                  Skin line:{' '}
                  <b className="text-gold1">
                    {state.facts.sets.filter((s) => s !== 'Legacy').join(', ')}
                  </b>
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-grey1">
              No price facts for this skin yet (facts snapshot pending).
            </p>
          )}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link to="/games/quick-battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Battle skins like this
        </Link>
        <Link
          to="/champions/$id"
          params={{ id: state.championId }}
          className={btnSecondarySm}
        >
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          {state.championName}'s wardrobe
        </Link>
      </div>
    </div>
  )
}
