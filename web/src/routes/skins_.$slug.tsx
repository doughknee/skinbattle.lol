import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faChartLine,
  faCircleInfo,
  faRankingStar,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import SkinVoteBar from '~/components/SkinVoteBar'
import { api } from '~/lib/api'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fetchSkinPage } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'
import { kebab } from '~/lib/games/slug'

export const Route = createFileRoute('/skins_/$slug')({
  // Stable URLs, immutable key: any slug whose trailing ID resolves gets
  // redirected to the canonical spelling - old links survive renames.
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
    // Star/ban totals come from the Go API. Display rule: these are the
    // SUPERLATIVE currency (badges), never a competing rank - Elo above
    // is the rank. Non-fatal: the dossier must not break when the API is
    // unreachable; the badges just hide.
    let votes: { stars: number; bans: number } | null = null
    try {
      const champ = await api.champion(state.championId)
      const s = champ.skins.find((sk) => sk.id === state.skinId)
      if (s) {
        votes = {
          stars: s.total_stars || 0,
          bans: s.total_x || 0,
        }
      }
    } catch {
      /* badges hide */
    }
    return { ...state, votes }
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.name} · Skin Battle` },
          {
            name: 'description',
            content: `${loaderData.name} (${loaderData.championName}): community rating, rank, and price facts on Skin Battle.`,
          },
          ...ogMeta({
            title: `${loaderData.name} · Skin Battle`,
            description: loaderData.community
              ? `Rated ${loaderData.community.rating} ± ${loaderData.community.uncertainty} · #${loaderData.community.rank} of ${loaderData.ratedTotal} · ${loaderData.community.battles} battles`
              : 'Unranked: no battles fought yet. Be the first.',
            imagePath: `/og/skin/${loaderData.skinId}`,
            path: `/skins/${loaderData.slug}`,
          }),
        ]
      : [{ title: 'Skin · Skin Battle' }],
  }),
  notFoundComponent: () => (
    <ErrorState
      title="No such skin"
      message="That link doesn't resolve to a skin in the catalog."
      retry={false}
      back={{ to: '/rankings/all', label: 'The full ranking' }}
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

// "New this patch" badge window: League patches land ~biweekly, so three
// weeks catches the current drop plus stragglers.
const isNew = (release: string | null | undefined) =>
  !!release && Date.now() - Date.parse(`${release}T00:00:00Z`) < 21 * 86_400_000

function SkinPage() {
  const state = Route.useLoaderData()
  const posthog = usePostHog()

  useEffect(() => {
    rememberGuestToken(state.guestToken)
  }, [state.guestToken])

  useEffect(() => {
    posthog.capture('skin_page_viewed', {
      skin_id: state.skinId,
      skin_name: state.name,
      champion_id: state.championId,
      champion_name: state.championName,
      elo_rank: state.community?.rank ?? null,
      battles: state.community?.battles ?? 0,
    })
  // Only fire once per skin: re-firing on posthog identity changes isn't useful here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.skinId])

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
        <h1 className="flex flex-wrap items-center gap-3 font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {state.name}
          {(isNew(state.facts?.release) ||
            state.facts?.availability === 'Upcoming') && (
            <span className="bg-blue5/90 px-2 py-1 font-sans text-xs font-bold uppercase tracking-wider text-blue1 outline outline-blue3 -outline-offset-1">
              {state.facts?.availability === 'Upcoming'
                ? 'Upcoming'
                : 'New this patch'}
            </span>
          )}
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
                  Early ranking: needs more votes.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-serif text-3xl font-bold text-grey1">
                Unranked
              </p>
              <p className="text-sm text-grey1">
                No battles fought yet. Be the first.
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
                    <b className={state.personal.gap > 0 ? 'text-blue2' : 'text-danger'}>
                      {state.personal.gap > 0 ? '+' : '−'}
                      {Math.abs(state.personal.gap)} vs the room
                    </b>
                  </>
                )}
              </p>
              <Link
                to="/profile"
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
                  <Link
                    to="/rankings/$slice"
                    params={{ slice: `price-${state.facts.cost}` }}
                    className="font-bold text-gold1 transition duration-150 hover:text-gold2"
                    title={`Best ${state.facts.cost.toLocaleString()} RP skins`}
                  >
                    {state.facts.cost.toLocaleString()} RP
                  </Link>
                  {state.facts.availability === 'Legacy' && (
                    <span> · Legacy vault, not even buyable anymore</span>
                  )}
                </p>
              )}
              {state.facts.release && <p>Released {fmtDate(state.facts.release)}</p>}
              {state.facts.sets.filter((s) => s !== 'Legacy').length > 0 && (
                <p>
                  Skin line:{' '}
                  {state.facts.sets
                    .filter((s) => s !== 'Legacy')
                    .map((s, i) => (
                      <span key={s}>
                        {i > 0 && ', '}
                        <Link
                          to="/rankings/$slice"
                          params={{ slice: `line-${kebab(s)}` }}
                          className="font-bold text-gold1 transition duration-150 hover:text-gold2"
                          title={`Best ${s} skins`}
                        >
                          {s}
                        </Link>
                      </span>
                    ))}
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

      <SkinVoteBar
        skinId={state.skinId}
        championId={state.championId}
        skinName={state.name}
        baseStars={state.votes?.stars ?? 0}
        baseBans={state.votes?.bans ?? 0}
      />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link to="/battle" className={btnPrimarySm}>
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
        <Link
          to="/rankings/$slice"
          params={{ slice: `champion-${state.championId.toLowerCase()}` }}
          className={btnSecondarySm}
        >
          <FontAwesomeIcon icon={faRankingStar} className="h-4" />
          {state.championName} rankings
        </Link>
      </div>
    </div>
  )
}
