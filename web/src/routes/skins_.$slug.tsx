import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faChartLine,
  faRankingStar,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import JsonLd from '~/components/JsonLd'
import Verdict from '~/components/Verdict'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fallbackToRaw, skinThumb } from '~/lib/img'
import { fetchSkinPage } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { breadcrumbJsonLd } from '~/lib/games/jsonLd'
import { robotsMeta, skinIsIndexable } from '~/lib/games/seo'
import { kebab } from '~/lib/games/slug'
import { skinTitleName } from '~/lib/skinName'
import type { SkinPageState } from '~/lib/games/types'

// The skin dossier: one URL per skin, and the answer surface for "what is
// <skin>" - what it costs, when it landed, what line it belongs to, and where
// the community puts it. Everything that answers that is server-rendered from
// loader data and present with JavaScript off.
//
// Two disciplines run through the page. Only VERIFIED attributes are rendered:
// every fact comes from the committed League Wiki snapshot or the live
// catalog, and anything missing is omitted rather than printed empty - ~1,900
// pages that each say "Price: unknown" are ~1,900 thin pages. And the verdict
// is skinAnswerBlock's call, never this page's: a dossier's crowd is its OWN,
// most skins have only a handful of voters, so provisional is the ordinary
// reading here and gets the same panel, prominence and weight a settled one
// would.

export const Route = createFileRoute('/skins_/$slug')({
  // Stable URLs, immutable key: any slug whose trailing ID resolves gets
  // redirected to the canonical spelling - old links survive renames. A slug
  // that resolves to nothing (no trailing id, or one no skin carries) returns
  // a real 404 through notFound(), not a 500 - verified against production,
  // which is why this route is not part of DONI-92's defect.
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
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Skin | SkinBattle' }] }
    const title = `${skinTitleName(loaderData.name, loaderData.championName)} | SkinBattle`
    // Generated from this skin's live rating, so it moves as votes land and no
    // two dossiers share a sentence - the only defence against ~1,900
    // near-identical descriptions. No "best" claim the data has not paid for:
    // skinAnswerBlock decides these words, here and in the body both.
    const description = `${loaderData.answer.answer} ${factsLine(loaderData)}`
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        // Never-battled skins are thin/near-duplicate; index once they fight.
        ...robotsMeta(skinIsIndexable(loaderData.community?.battles)),
        ...ogMeta({
          title,
          description,
          imagePath: `/og/skin/${loaderData.skinId}`,
          path: `/skins/${loaderData.slug}`,
        }),
      ],
      links: [canonicalLink(`/skins/${loaderData.slug}`)],
    }
  },
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

// ─── facts ──────────────────────────────────────────────────────────────────

// Parsed as UTC and printed as UTC: a date-only release must name the same day
// in every timezone, and must not shift between the server render and the
// client one.
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

// The verified attributes as one sentence, for the meta description. Same
// omit-if-missing rule the body uses, so a skin the snapshot has nothing for
// gets a shorter description rather than a hollow one.
function factsLine(state: SkinPageState): string {
  const f = state.facts
  // "An Ahri skin", "A Lux skin": the article follows the name.
  const article = /^[aeiou]/i.test(state.championName) ? 'An' : 'A'
  const parts = [`${article} ${state.championName} skin`]
  if (f?.cost != null) parts.push(`${f.cost.toLocaleString('en-US')} RP`)
  if (f?.release) parts.push(`released ${fmtDate(f.release)}`)
  const line = f?.sets.filter((s) => s !== 'Legacy')[0]
  if (line) parts.push(`part of the ${line} line`)
  return `${parts.join(', ')}.`
}

// "New this patch" badge window: League patches land ~biweekly, so three
// weeks catches the current drop plus stragglers.
const isNew = (release: string | null | undefined) =>
  !!release && Date.now() - Date.parse(`${release}T00:00:00Z`) < 21 * 86_400_000

// One row of the attribute list. Only rendered by callers that already know
// the value exists - the omit-if-missing decision lives at each call site, so
// no path reaches here with nothing to print.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-icon/15 py-3">
      <dt className="text-xs font-semibold uppercase tracking-widest text-grey1">
        {label}
      </dt>
      <dd className="font-serif text-lg text-gold1">{children}</dd>
    </div>
  )
}

// No font-semibold: globals.css routes bold body text into Cinzel, the display
// face, which mid-sentence reads as a different voice.
const factLink =
  'text-gold2 underline underline-offset-4 transition duration-150 hover:text-gold1'

// ─── page ───────────────────────────────────────────────────────────────────

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
  const f = state.facts
  // Over head-to-head battles only: `battles` also counts Tier Drop
  // placements, which have no "win".
  const winRate =
    c && c.h2hBattles > 0 ? Math.round((100 * c.wins) / c.h2hBattles) : null
  const lines = f?.sets.filter((s) => s !== 'Legacy') ?? []
  const n = (v: number) => v.toLocaleString('en-US')

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      {/* The trail the site's own IA describes: /skins is the catalog door,
          /champions its second lens, and this skin sits under its champion. */}
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Skins', path: '/skins' },
          { name: state.championName, path: `/champions/${state.championId.toLowerCase()}` },
          { name: state.name, path: `/skins/${state.slug}` },
        ])}
      />

      <header className="animate-fade-up mb-6">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm font-semibold">
          <ol className="flex flex-wrap items-center gap-2 text-grey1">
            <li>
              <Link to="/" className="transition duration-150 hover:text-gold1">
                Home
              </Link>
            </li>
            <li aria-hidden className="text-icon/50">
              /
            </li>
            <li>
              <Link
                to="/skins"
                className="transition duration-150 hover:text-gold1"
              >
                Skins
              </Link>
            </li>
            <li aria-hidden className="text-icon/50">
              /
            </li>
            <li>
              <Link
                to="/champions/$id"
                params={{ id: state.championId.toLowerCase() }}
                className="transition duration-150 hover:text-gold1"
              >
                {state.championName}
              </Link>
            </li>
            <li aria-hidden className="text-icon/50">
              /
            </li>
            <li aria-current="page" className="text-gold2">
              {state.name}
            </li>
          </ol>
        </nav>

        <h1 className="flex flex-wrap items-center gap-3 font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {state.name}
          {(isNew(f?.release) || f?.availability === 'Upcoming') && (
            <span className="bg-blue5/90 px-2 py-1 font-sans text-xs font-bold uppercase tracking-wider text-blue1 outline outline-blue3 -outline-offset-1">
              {f?.availability === 'Upcoming' ? 'Upcoming' : 'New this patch'}
            </span>
          )}
        </h1>
        <p className="mt-2 text-xl italic text-gold2">
          A{' '}
          <Link
            to="/champions/$id"
            params={{ id: state.championId.toLowerCase() }}
            className="transition duration-150 hover:text-gold1"
          >
            {state.championName}
          </Link>{' '}
          skin
        </p>
      </header>

      {/* The answer, before the evidence. Which branch this renders is
          skinAnswerBlock's call, never the page's - see the module header. */}
      <Verdict
        answer={state.answer}
        rated={state.ratedTotal}
        total={state.catalogTotal}
      >
        <Link to="/battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Battle this skin
        </Link>
        <Link
          to="/rankings/$slice"
          params={{ slice: `champion-${state.championId.toLowerCase()}` }}
          className={btnSecondarySm}
        >
          <FontAwesomeIcon icon={faRankingStar} className="h-4" />
          {state.championName} skins, ranked
        </Link>
        {/* /methodology directly: /rankings/elo 301s here, and an internal
            link through a redirect wastes the hop. */}
        <Link to="/methodology" className={factLink}>
          How this rating is computed
        </Link>
      </Verdict>

      <div className="animate-fade-up relative mt-8 aspect-video w-full overflow-hidden bg-hextech-black/60 outline outline-icon/20 -outline-offset-2">
        <img
          src={state.splashUrl}
          alt={`${state.name} splash art`}
          loading="eager"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>

      {/* ── Verified attributes ──────────────────────────────── */}
      <section aria-labelledby="facts-heading" className="animate-fade-up mt-10">
        <h2
          id="facts-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-gold2"
        >
          The facts
        </h2>
        <dl className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
          <Fact label="Champion">
            <Link
              to="/champions/$id"
              params={{ id: state.championId.toLowerCase() }}
              className={factLink}
            >
              {state.championName}
            </Link>
          </Fact>

          {c && (
            <>
              <Fact label="Community rating">
                {n(c.rating)}{' '}
                <span className="text-base text-grey1">± {c.uncertainty}</span>
              </Fact>
              <Fact label="Rank">
                #{n(c.rank)}{' '}
                <span className="text-base text-grey1">
                  of {n(state.ratedTotal)} ranked
                </span>
              </Fact>
              <Fact label="Battles">
                {n(c.battles)}
                {winRate !== null && (
                  <span className="text-base text-grey1">
                    {' '}
                    · {winRate}% won head-to-head
                  </span>
                )}
              </Fact>
            </>
          )}

          {f?.cost != null && (
            <Fact label="Price">
              <Link
                to="/rankings/$slice"
                params={{ slice: `price-${f.cost}` }}
                className={factLink}
                title={`Best ${n(f.cost)} RP skins`}
              >
                {n(f.cost)} RP
              </Link>
            </Fact>
          )}

          {f?.release && (
            <Fact label="Released">
              <time dateTime={f.release}>{fmtDate(f.release)}</time>
            </Fact>
          )}

          {lines.length > 0 && (
            <Fact label={lines.length === 1 ? 'Skin line' : 'Skin lines'}>
              {lines.map((s, i) => (
                <span key={s}>
                  {i > 0 && ', '}
                  <Link
                    to="/rankings/$slice"
                    params={{ slice: `line-${kebab(s)}` }}
                    className={factLink}
                    title={`Best ${s} skins`}
                  >
                    {s}
                  </Link>
                </span>
              ))}
            </Fact>
          )}

          {f?.availability && (
            <Fact label="Availability">
              {f.availability}
              {f.availability === 'Legacy' && (
                <span className="text-base text-grey1">
                  {' '}
                  · vaulted, not currently buyable
                </span>
              )}
            </Fact>
          )}

          {f?.rarity && <Fact label="Rarity">{f.rarity}</Fact>}
        </dl>

        {/* Provenance, because the two halves of this page come from different
            places and only one of them is ours. Chromas are deliberately absent:
            no source this repo commits carries them, and an attribute that
            cannot be verified does not get printed. */}
        <p className="mt-5 max-w-2xl text-sm text-grey1">
          Splash art, champion and skin names are Riot Games'. Prices, release
          dates and skin lines come from the committed League Wiki snapshot
          {f ? '' : ', which holds nothing for this skin yet'}. The rating and
          the rank are SkinBattle's own, computed from community battles -{' '}
          <Link to="/methodology" className={factLink}>
            how that works
          </Link>
          .
        </p>
      </section>

      {/* ── The viewer's own take ────────────────────────────── */}
      {state.personal && (
        <section className="animate-fade-up mt-10 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gold2">
            <FontAwesomeIcon icon={faChartLine} className="h-3.5" />
            Your take
          </h2>
          <p className="mt-3 font-serif text-3xl font-bold text-gold1">
            {n(state.personal.rating)}
          </p>
          <p className="text-sm text-grey1">
            from {n(state.personal.battles)}{' '}
            {state.personal.battles === 1 ? 'battle' : 'battles'} of yours
            {state.personal.gap !== null &&
              Math.abs(state.personal.gap) >= 50 && (
                <>
                  {' '}
                  ·{' '}
                  <b
                    className={
                      state.personal.gap > 0 ? 'text-blue2' : 'text-danger'
                    }
                  >
                    {state.personal.gap > 0 ? '+' : '−'}
                    {Math.abs(state.personal.gap)} vs the room
                  </b>
                </>
              )}
          </p>
          <Link
            to="/profile"
            className="mt-1 inline-block text-sm font-bold text-gold2 transition duration-150 hover:text-gold1"
          >
            See your full Mirror →
          </Link>
        </section>
      )}

      {/* ── Where to go next ─────────────────────────────────── */}
      {state.related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-12">
          <h2
            id="related-heading"
            className="mb-1 font-serif text-2xl font-bold text-gold2"
          >
            More {state.championName} skins
          </h2>
          <p className="mb-4 text-sm text-grey1">
            The next few in release order.{' '}
            <Link
              to="/champions/$id"
              params={{ id: state.championId.toLowerCase() }}
              className={factLink}
            >
              See the whole wardrobe
            </Link>
            .
          </p>
          <ul className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
            {state.related.map((r) => (
              <li key={r.skinId}>
                <Link
                  to="/skins/$slug"
                  params={{ slug: r.slug }}
                  className="block bg-hextech-black/30 outline outline-icon/20 -outline-offset-1 transition duration-150 hover:outline-gold2"
                >
                  <img
                    src={skinThumb(r.splashUrl, 384)}
                    data-raw={r.splashUrl}
                    onError={fallbackToRaw}
                    alt={`${r.name} splash art`}
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full object-cover"
                  />
                  <span className="block truncate p-2 font-serif text-sm font-bold text-gold1">
                    {r.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link
          to="/champions/$id"
          params={{ id: state.championId.toLowerCase() }}
          className={btnSecondarySm}
        >
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          {state.championName}'s wardrobe
        </Link>
        <Link
          to="/rankings/$slice"
          params={{ slice: 'all' }}
          className={btnSecondarySm}
        >
          <FontAwesomeIcon icon={faRankingStar} className="h-4" />
          Full ranking
        </Link>
        <Link to="/skins" className={btnSecondarySm}>
          All skins
        </Link>
      </div>
    </div>
  )
}
