import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLayerGroup, faShuffle } from '@fortawesome/free-solid-svg-icons'
import { api, type ApiError } from '~/lib/api'
import { fetchChampionWardrobe, fetchRankings } from '~/lib/games/serverFns'
import SkinCard from '~/components/SkinCard'
import Dropdown from '~/components/Dropdown'
import ErrorState from '~/components/ErrorState'
import JsonLd from '~/components/JsonLd'
import ShareRanking from '~/components/ShareRanking'
import Verdict from '~/components/Verdict'
import { ChampionDetailSkeleton } from '~/components/Skeletons'
import { championDisplayName } from '~/lib/skinName'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { breadcrumbJsonLd, itemListJsonLd } from '~/lib/games/jsonLd'
import { answerBlock, type AnswerVoters } from '~/lib/games/answer'
import {
  rankingStateOf,
  readSessionBattles,
  settleCta,
  unfurlAsk,
} from '~/lib/games/settle'
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
    // Two sources, one job each. The Go API supplies the champion's title and
    // lore - Riot text nothing else on the site holds. The games catalog
    // supplies the wardrobe: the same rows the champion's ranking slice, the
    // dossiers, /skins and the sitemap are built from, so the heading, the
    // verdict's "M of N" and the directory card all count one set. (The Go
    // copy carries the base look and syncs on its own clock: it gave Ahri 21
    // on the directory to this page's 20, and ran two skins ahead of the
    // catalog the rankings use.)
    //
    // An id nothing resolves - `miss-fortune` for missfortune, a typo, a dead
    // link - is a not-found, not a server fault, and api.champion throws on
    // any non-2xx. Letting that throw escape rendered errorComponent with a
    // 500, which tells a crawler the server is broken and can suppress
    // crawling of all 173 champion pages; a 404 is forgotten cleanly. Only
    // 404 converts: if the API is down that 500 is honest, and turning an
    // outage into 404s would deindex every real page.
    const [champion, catalog] = await Promise.all([
      api.champion(params.id).catch((e: ApiError) => {
        throw e.status === 404 ? notFound() : e
      }),
      fetchChampionWardrobe({ data: { id: params.id } }),
    ])
    if (!catalog) throw notFound()
    // One URL per champion. Both sources resolve an id in any casing, so
    // /champions/Aatrox and /champions/AATROX would each serve this page with
    // a 200 - three URLs, one page, no way for a crawler to pick. Redirect to
    // the lowercase form (what the sitemap and every internal link use), the
    // same way a non-canonical skin slug redirects in skins_.$slug.
    const canonicalId = catalog.championId.toLowerCase()
    if (params.id !== canonicalId) {
      throw redirect({
        to: '/champions/$id',
        params: { id: canonicalId },
        statusCode: 301,
      })
    }

    // The wardrobe proper: base look excluded, release order.
    const wardrobe = catalog.skins

    // Battle-Elo ranks for the wardrobe - display rule: Elo is THE rank;
    // star/ban/vote counts are badges and sorts, never a competing rank.
    // Non-fatal: the page works without the games layer; the ranked list and
    // the badges just drop out and the verdict reads as "no battles yet".
    let rows: RankingRow[] = []
    // Heads behind rows[0]. Taken from the slice rather than counted again
    // here: this is the same slice at offset 0, so its leader IS rows[0], and
    // the verdict rule must not be able to read differently on two pages
    // about the same skin.
    let leaderVoters: AnswerVoters = { members: 0, guests: 0 }
    try {
      const r = await fetchRankings({ data: { slice: `champion-${canonicalId}` } })
      // Rows are rating-desc and capped at 100 - no champion is close, so this
      // is the whole ranking, which is what lets the ItemList mirror it exactly.
      if (r) {
        rows = r.rows
        leaderVoters = r.leaderVoters
      }
    } catch {
      /* unrated wardrobe - no ranked list, no badges */
    }

    const name = championDisplayName(catalog.championId)
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
            voters: leaderVoters,
          }
        : null,
      rated: rows.length,
      total: wardrobe.length,
    })

    return {
      champion: { id: catalog.championId, title: champion.title, lore: champion.lore },
      // Hero art: the base look from the catalog, else the Go API's first skin.
      splash: catalog.splashUrl ?? champion.skins[0]?.splash_url ?? null,
      wardrobe,
      rows,
      answer,
      name,
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Champion | SkinBattle' }] }
    const { champion, wardrobe, name, answer } = loaderData
    // The query this page answers, in the one line search renders. "Best" is
    // the search intent, not a claim: the verdict block on the page decides
    // what the data pays for, in the same words every other page uses. No
    // current #1 in the title - a winner moves with the next vote, a title
    // is cached for weeks.
    const title = `Best ${name} Skins Ranked by Players | SkinBattle`
    // Stable per champion: names the fields the page actually carries and
    // nothing volatile. The live verdict (the current leader, its band, the
    // coverage) is on the page itself, where it can change.
    const description = `Every ${name} skin ranked by SkinBattle community battles, with a rating, uncertainty band and battle count for each of the ${wardrobe.length}, plus the full wardrobe in splash art.`
    const path = `/champions/${champion.id.toLowerCase()}`
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        // The unfurl is a share, not a search snippet: its card is the
        // champion's own ranking slice (live top three over the leader's
        // splash, verdict state on it) and its text is the verdict sentence
        // itself plus the ask - what makes someone click, where the stable
        // search description above stays what makes a crawler trust the page.
        ...ogMeta({
          title,
          description: `${answer.answer} ${unfurlAsk(answer.confidence)}`,
          imagePath: `/og/rankings/champion-${champion.id.toLowerCase()}`,
          path,
        }),
      ],
      links: [canonicalLink(path)],
    }
  },
  pendingComponent: () => (
    <ChampionDetailSkeleton quip="One-shotting the ADC..." />
  ),
  notFoundComponent: () => (
    <ErrorState
      title="No such champion"
      message="That link doesn't resolve to a champion. Champion URLs use the League client's own spelling with no spaces or hyphens - /champions/missfortune."
      retry={false}
      back={{ to: '/champions', label: 'All champions' }}
    />
  ),
  // Only genuine failures land here now - the API being down, not a bad id -
  // so a reload is worth offering.
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load this champion"
      message={error.message}
      back={{ to: '/champions', label: 'Back to champions' }}
    />
  ),
  component: ChampionPage,
})

// ─── page ───────────────────────────────────────────────────────────────────

function ChampionPage() {
  const { champion, wardrobe, rows, answer, name } = Route.useLoaderData()
  const posthog = usePostHog()
  const [loreExpanded, setLoreExpanded] = useState(false)
  const [sortBy, setSortBy] = useState('release')

  // The ask follows the verdict: "help settle" while it is provisional, an
  // invitation to argue once it is settled. Same words the /settle hub and the
  // ranking slice use (settle.ts), so the site makes one kind of ask.
  const slug = champion.id.toLowerCase()
  const rankingState = rankingStateOf(answer.confidence)
  const cta = settleCta(rankingState, name)

  // The loop's landing event: which ranking, in what state, and whether this
  // visit has already battled (so "ranking viewed after a battle" is a filter,
  // not a second event). Once per champion, like skin_page_viewed.
  useEffect(() => {
    posthog?.capture('ranking_viewed', {
      page_type: 'champion',
      champion: slug,
      ranking_state: rankingState,
      rated: rows.length,
      total: wardrobe.length,
      session_battles: readSessionBattles(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const ctaClick = (which: 'battle' | 'tier-drop') =>
    posthog?.capture('settle_cta_clicked', {
      page_type: 'champion',
      champion: slug,
      ranking_state: rankingState,
      cta: which,
    })

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

  const { splash } = Route.useLoaderData()
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
          {/* "Best <name> Skins" is the question the page exists to answer;
              the verdict below is the answer, and it says provisional when
              the data says provisional. The line under it names the frame:
              these are community rankings, not an editor's list. */}
          <h1 className="text-shadow-hero font-serif text-5xl md:text-7xl font-bold text-gold1">
            Best {name} Skins
          </h1>
          <p className="text-shadow-hero mt-2 text-xl md:text-2xl italic text-gold2">
            Community rankings · All {wardrobe.length} of them · {champion.title}
          </p>
        </div>
      </section>

      {/* ── The answer ───────────────────────────────────────── */}
      <div className="container mx-auto max-w-5xl px-6 pt-4">
        <Verdict answer={answer} rated={rows.length} total={wardrobe.length}>
          {/* The supporting line for the ask, in the verdict's own state:
              provisional says what a battle here does, settled says the
              ranking is open to argument. Never a count of votes to go. */}
          <p className="w-full text-sm text-gold1/90">{cta.hint}</p>
          {/* Scoped battle: every pair is dealt from this wardrobe, so each
              pick is evidence for THIS ranking rather than for two skins the
              visitor did not come for. */}
          <Link
            to="/battle"
            search={{ champion: slug }}
            onClick={() => ctaClick('battle')}
            className={btnPrimarySm}
          >
            <FontAwesomeIcon icon={faShuffle} className="h-4" />
            {cta.label}
          </Link>
          {wardrobe.length >= MIN_TIER_BOARD && (
            <Link
              to="/battle/tier-drop"
              search={{ set: `champion:${champion.id}` }}
              onClick={() => ctaClick('tier-drop')}
              className={btnSecondarySm}
            >
              <FontAwesomeIcon icon={faLayerGroup} className="h-4" />
              Rank all {wardrobe.length} in one pass
            </Link>
          )}
          <ShareRanking
            title={name}
            champion
            top={rows.map((r) => r.name)}
            state={rankingState}
            battles={rows[0]?.battles ?? 0}
            path={championPath}
            pageType="champion"
            championSlug={slug}
          />
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
