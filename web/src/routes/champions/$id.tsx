import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLayerGroup, faShuffle } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { fetchRankings } from '~/lib/games/serverFns'
import SkinCard from '~/components/SkinCard'
import Dropdown from '~/components/Dropdown'
import ErrorState from '~/components/ErrorState'
import JsonLd from '~/components/JsonLd'
import Verdict from '~/components/Verdict'
import { ChampionDetailSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { breadcrumbJsonLd, itemListJsonLd } from '~/lib/games/jsonLd'
import { answerBlock } from '~/lib/games/answer'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import type { RankingRow } from '~/lib/games/types'

// The champion page is the site's widest answer surface: 173 of them, one per
// champion, each covering a question people actually ask ("which Ahri skin is
// best"). So everything that answers it - the heading, the verdict, the ranked
// list - is server-rendered from loader data and present with JavaScript off.
//
// It is deliberately NOT gated by seo.ts: a wardrobe is useful even with no
// battle data at all, so all 173 ship regardless of volume. seo.routes.test.ts
// asserts that exception explicitly.

// Enough skins for Tier Drop to build a champion board (MIN_BOARD in
// server/tierlist.ts). Below it the CTA would silently serve the daily board
// instead of this champion's, so it isn't offered.
const MIN_TIER_BOARD = 4

export const Route = createFileRoute('/champions/$id')({
  loader: async ({ params }) => {
    // Base (public) champion data. User-vote columns are layered in
    // client-side once we have a Logto access token.
    const champion = await api.champion(params.id)
    // One URL per champion. The API resolves an id in any casing, so
    // /champions/Aatrox and /champions/AATROX would each serve this page with
    // a 200 - three URLs, one page, no way for a crawler to pick. Redirect to
    // the lowercase form (what the sitemap and every internal link use), the
    // same way a non-canonical skin slug redirects in skins_.$slug.
    const canonicalId = champion.id.toLowerCase()
    if (params.id !== canonicalId) {
      throw redirect({
        to: '/champions/$id',
        params: { id: canonicalId },
        statusCode: 301,
      })
    }

    // The wardrobe proper. num 0 is the champion's default look, not a skin
    // anyone owns: /skins, the battle pool and the champion ranking slice all
    // exclude it, so this page counts the same set they do - otherwise the
    // heading says 17 while the verdict says 16 on the same screen. The base
    // splash still leads the page as the hero art.
    const wardrobe = champion.skins.filter((s) => s.num !== 0)

    // Battle-Elo ranks for the wardrobe - display rule: Elo is THE rank;
    // star/ban/vote counts are badges and sorts, never a competing rank.
    // Non-fatal: the page works without the games layer; the ranked list and
    // the badges just drop out and the verdict reads as "no battles yet".
    let rows: RankingRow[] = []
    try {
      const r = await fetchRankings({ data: { slice: `champion-${canonicalId}` } })
      // Rows are rating-desc and capped at 100 - no champion is close, so this
      // is the whole ranking, which is what lets the ItemList mirror it exactly.
      if (r) rows = r.rows
    } catch {
      /* unrated wardrobe - no ranked list, no badges */
    }

    const name = championDisplayName(champion.id)
    // Built here rather than in the component so head() and the body quote the
    // same sentence. answerBlock is a deterministic template over live ratings
    // - no model runs, and the same data always renders the same words, which
    // is what makes the page quotable. Counts come from what this page shows.
    const answer = answerBlock({
      scope: `${name} skins`,
      leader: rows[0]
        ? {
            name: rows[0].name,
            rating: rows[0].rating,
            uncertainty: rows[0].uncertainty,
            battles: rows[0].battles,
          }
        : null,
      rated: rows.length,
      total: wardrobe.length,
    })

    return { champion, wardrobe, rows, answer, name }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Champion · Skin Battle' }] }
    const { champion, wardrobe, answer, name } = loaderData
    // "<Name> Skins", not "<Name>": it says what the page is, and it stops the
    // champion page colliding with its own base-skin page, which titles itself
    // "Ahri · Skin Battle" too.
    const title = `${name} Skins · Skin Battle`
    // Unique per champion because it is generated from that champion's live
    // ratings - the leader, its band, the coverage - and moves as votes land.
    // Nothing boilerplate, which is the only defence against 173 near-identical
    // descriptions. No "best" claim: answerBlock decides what the data pays for.
    const description = `${answer.answer} All ${wardrobe.length} ${name} skins, with splash art, prices, and release dates.`
    const path = `/champions/${champion.id.toLowerCase()}`
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        ...ogMeta({ title, description, card: 'games', path }),
      ],
      links: [canonicalLink(path)],
    }
  },
  pendingComponent: () => (
    <ChampionDetailSkeleton quip="One-shotting the ADC..." />
  ),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Champion not found"
      message={error.message}
      retry={false}
      back={{ to: '/champions', label: 'Back to champions' }}
    />
  ),
  component: ChampionPage,
})

// ─── page ───────────────────────────────────────────────────────────────────

function ChampionPage() {
  const { champion, wardrobe, rows, answer, name } = Route.useLoaderData()
  const [loreExpanded, setLoreExpanded] = useState(false)
  const [sortBy, setSortBy] = useState('release')

  const skinSortOptions = [
    { value: 'release', label: 'Release Order' },
    { value: 'rating', label: 'Battle Rating' },
  ]

  // The rank badge is the battle-Elo rank within this wardrobe. Skins nobody
  // has battled yet get no badge - ranking zeroes reads as broken.
  const ranked = useMemo(
    () => new Map(rows.map((r) => [r.skinId, r])),
    [rows],
  )

  const sortedSkins = useMemo(() => {
    const skins = [...wardrobe]
    switch (sortBy) {
      case 'rating':
        skins.sort(
          (a, b) =>
            (ranked.get(b.id)?.rating ?? -Infinity) -
              (ranked.get(a.id)?.rating ?? -Infinity) || a.num - b.num,
        )
        break
      default:
        skins.sort((a, b) => a.num - b.num)
    }
    return skins
  }, [wardrobe, sortBy, ranked])

  const splash =
    champion.skins.find((s) => s.num === 0)?.splash_url ??
    champion.skins[0]?.splash_url
  const championPath = `/champions/${champion.id.toLowerCase()}`
  const unrated = wardrobe.length - rows.length

  return (
    <>
      {/* The ranked list and this markup are built from the same `rows` array
          in the same order, so ItemList positions are the visible positions -
          nothing re-sorts on the client. */}
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Champions', path: '/champions' },
            { name, path: championPath },
          ]),
          ...(rows.length > 0
            ? [
                itemListJsonLd({
                  name: `${name} skins ranked by community battles`,
                  items: rows.map((r) => ({
                    name: r.name,
                    path: `/skins/${r.slug}`,
                  })),
                }),
              ]
            : []),
        ]}
      />

      {/* ── Champion hero ────────────────────────────────────── */}
      <section className="relative min-h-[52vh] w-full overflow-hidden">
        {/* The splash is masked to transparent at the bottom so it dissolves
            into the viewport-fixed page gradient - the same gradient the next
            section sits on - for a true crossfade, not a hard seam. */}
        {splash && (
          <img
            src={splash}
            alt={`${name} splash art`}
            className="absolute inset-0 h-full w-full object-cover object-top [mask-image:linear-gradient(to_bottom,#000_42%,transparent_94%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_42%,transparent_94%)]"
          />
        )}
        {/* Left wash for title legibility, faded out at the bottom with the art. */}
        <div className="absolute inset-0 bg-gradient-to-r from-hextech-black/85 via-hextech-black/30 to-transparent [mask-image:linear-gradient(to_bottom,#000_42%,transparent_94%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_42%,transparent_94%)]" />

        <div className="animate-fade-up container mx-auto max-w-5xl px-6 relative z-10 flex min-h-[52vh] flex-col justify-end pt-28 pb-16">
          <nav aria-label="Breadcrumb" className="mb-6 text-sm font-semibold">
            <ol className="text-shadow-hero flex flex-wrap items-center gap-2 text-grey1">
              <li>
                <Link
                  to="/"
                  className="transition duration-150 hover:text-gold1"
                >
                  Home
                </Link>
              </li>
              <li aria-hidden className="text-icon/50">
                /
              </li>
              <li>
                <Link
                  to="/champions"
                  className="transition duration-150 hover:text-gold1"
                >
                  Champions
                </Link>
              </li>
              <li aria-hidden className="text-icon/50">
                /
              </li>
              <li aria-current="page" className="text-gold2">
                {name}
              </li>
            </ol>
          </nav>
          <h1 className="text-shadow-hero font-serif text-5xl md:text-7xl font-bold text-gold1">
            {name} Skins
          </h1>
          <p className="text-shadow-hero mt-2 text-xl md:text-2xl italic text-gold2">
            All {wardrobe.length} of them · {champion.title}
          </p>
        </div>
      </section>

      {/* ── The answer ───────────────────────────────────────── */}
      <div className="container mx-auto max-w-5xl px-6 pt-4">
        <Verdict answer={answer} rated={rows.length} total={wardrobe.length}>
          {wardrobe.length >= MIN_TIER_BOARD && (
            <Link
              to="/battle/tier-drop"
              search={{ set: `champion:${champion.id}` }}
              className={btnPrimarySm}
            >
              <FontAwesomeIcon icon={faLayerGroup} className="h-4" />
              Rank all {wardrobe.length} in one pass
            </Link>
          )}
          <Link to="/battle" className={btnSecondarySm}>
            <FontAwesomeIcon icon={faShuffle} className="h-4" />
            Battle head-to-head
          </Link>
          <Link
            to="/methodology"
            className="text-sm font-bold text-gold2 underline underline-offset-4 transition duration-150 hover:text-gold1"
          >
            How {name}'s ratings are computed
          </Link>
        </Verdict>
      </div>

      {/* ── The ranking ──────────────────────────────────────── */}
      {rows.length > 0 && (
        <section className="container mx-auto max-w-5xl px-6 pt-14">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="mb-1 font-serif text-3xl md:text-4xl font-bold text-gold2">
                {name} skins, ranked
              </h2>
              <p className="text-grey1">
                Every {name} skin with battle data, best first.
                {unrated > 0 && (
                  <>
                    {' '}
                    {unrated} {unrated === 1 ? 'more is' : 'more are'} still
                    waiting for a first battle.
                  </>
                )}
              </p>
            </div>
            <Link
              to="/rankings/$slice"
              params={{ slice: `champion-${champion.id.toLowerCase()}` }}
              className="text-sm font-bold text-gold2 transition duration-150 hover:text-gold1"
            >
              Full ranking view →
            </Link>
          </div>

          <ol className="stagger flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.skinId}>
                <Link
                  to="/skins/$slug"
                  params={{ slug: row.slug }}
                  className="flex items-baseline gap-3 bg-hextech-black/30 px-4 py-3 outline outline-icon/20 -outline-offset-1 transition duration-150 hover:bg-hextech-black/60 hover:outline-gold2"
                >
                  <span
                    className={`w-8 shrink-0 font-serif text-lg font-bold tabular-nums ${
                      row.rank === 1 ? 'text-gold2' : 'text-gold1/60'
                    }`}
                  >
                    {row.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-serif font-bold text-gold1">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-grey1 sm:text-sm">
                    {row.rating.toLocaleString('en-US')}
                    <span className="text-grey1/70"> ±{row.uncertainty}</span>
                    <span className="hidden sm:inline">
                      {' '}
                      · {row.battles}{' '}
                      {row.battles === 1 ? 'battle' : 'battles'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── The wardrobe ─────────────────────────────────────── */}
      <section className="container mx-auto max-w-5xl px-6 py-16">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold2 mb-2">
              The wardrobe
              <span className="ml-3 text-lg font-normal text-grey1">
                {wardrobe.length}
              </span>
            </h2>
            <p className="text-grey1">
              Every {name} skin in splash art. Tap any one for its dossier.
            </p>
          </div>
          <div className="w-44">
            <Dropdown
              options={skinSortOptions}
              onSelect={setSortBy}
              label={
                skinSortOptions.find((o) => o.value === sortBy)?.label ??
                'Sort By'
              }
              selectedValue={sortBy}
            />
          </div>
        </div>
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sortedSkins.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              championId={champion.id}
              rank={ranked.get(skin.id)?.rank}
              rankContext="in this wardrobe by battle rating"
            />
          ))}
        </div>
      </section>

      {/* ── Champion context ─────────────────────────────────── */}
      {/* Riot's lore is the one piece of copy on this page that also lives on
          every other League site, so it sits below the data rather than above
          it - the unique material leads. */}
      {champion.lore && (
        <section className="container mx-auto max-w-5xl px-6 pb-20">
          <h2 className="mb-3 font-serif text-2xl font-bold text-gold2">
            About {name}
          </h2>
          <div className="max-w-2xl">
            <p className={`text-grey1 ${loreExpanded ? '' : 'line-clamp-4'}`}>
              {champion.lore}
            </p>
            {champion.lore.length > 280 && (
              <button
                onClick={() => setLoreExpanded((e) => !e)}
                aria-expanded={loreExpanded}
                className="mt-2 cursor-pointer text-sm font-bold uppercase tracking-widest text-gold2 hover:text-gold1 transition duration-150"
              >
                {loreExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        </section>
      )}
    </>
  )
}
