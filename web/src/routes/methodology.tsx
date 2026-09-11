import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faFlaskVial,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import ErrorState from '~/components/ErrorState'
import { canonicalLink, ogMeta } from '~/lib/games/ogMeta'
import { fetchMethodology } from '~/lib/games/serverFns'
import {
  answerBlock,
  MAX_CONFIDENT_UNCERTAINTY,
  MIN_CONFIDENT_VOTERS,
  VOTER_SKIN_CAP,
  weightedBattlesFor,
} from '~/lib/games/answer'
import { MIN_INDEXABLE_BATTLES, MIN_INDEXABLE_RATED } from '~/lib/games/seo'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

// The provenance page: what the ratings are built from, how they are computed,
// and how much confidence each number has earned. Two audiences share it - a
// player asking "how does this work" and an answer engine deciding whether the
// site is quotable - so it is plain language first, with the constants named.
//
// Every number in this copy mirrors a constant in lib/games/server/ratings.ts,
// lib/games/seo.ts or lib/games/answer.ts. If a constant moves, this copy moves
// with it. The live figures come from the loader, never from memory.

const DESCRIPTION =
  'How SkinBattle ranks League of Legends skins: community head-to-head votes, a Bradley-Terry refit over the full match log, and a published uncertainty band on every rating.'

export const Route = createFileRoute('/methodology')({
  loader: () => fetchMethodology(),
  head: () => ({
    meta: [
      { title: 'Methodology · Skin Battle' },
      { name: 'description', content: DESCRIPTION },
      ...ogMeta({
        title: 'Methodology · Skin Battle',
        description: DESCRIPTION,
        card: 'games',
        path: '/methodology',
      }),
    ],
    links: [canonicalLink('/methodology')],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the methodology" message={error.message} />
  ),
  component: MethodologyPage,
})

// ─── building blocks ────────────────────────────────────────────────────────

const n = (v: number): string => Math.round(v).toLocaleString('en-US')

// ISO day, not a locale string: this renders on the server and hydrates on the
// client, and it is also the form a crawler can parse without guessing. Null
// on a database that has never been synced or refit - callers drop the clause
// rather than printing a placeholder into a sentence.
const day = (iso: string | null): string | null =>
  iso && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toISOString().slice(0, 10)
    : null

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="animate-fade-up mt-12">
      <h2 className="mb-3 font-serif text-2xl font-bold text-gold2 md:text-3xl">
        {title}
      </h2>
      <div className="space-y-4 text-grey1 [&_b]:text-gold1 [&_b]:font-semibold">
        {children}
      </div>
    </section>
  )
}

function ExampleRow({
  name,
  before,
  delta,
  after,
  note,
}: {
  name: string
  before: string
  delta: string
  after: string
  note: string
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-hextech-black/40 p-4 outline outline-icon/20 -outline-offset-2">
      <p className="w-full font-serif font-bold text-gold1 sm:w-44">{name}</p>
      <p className="text-sm text-grey1">
        {before} <FontAwesomeIcon icon={faArrowRight} className="mx-1 h-3" />{' '}
        <b className="font-semibold text-gold1">{after}</b>{' '}
        <span className="font-serif font-bold text-gold2">({delta})</span>
      </p>
      <p className="w-full text-xs text-grey1/80">{note}</p>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-hextech-black/30 p-4 text-center outline outline-icon/20 -outline-offset-2">
      <p className="font-serif text-2xl font-bold text-gold1 md:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-widest text-grey1">
        {label}
      </p>
    </div>
  )
}

// One worked answer block, rendered by the real helper so this page cannot
// drift from what the rest of the site actually says.
function AnswerSample({
  caption,
  scope,
  leader,
  rated,
  total,
}: {
  caption: string
  scope: string
  leader: {
    name: string
    rating: number
    uncertainty: number
    battles: number
    voters: { members: number; guests: number }
  } | null
  rated: number
  total: number
}) {
  const block = answerBlock({ scope, leader, rated, total })
  const tone =
    block.confidence === 'confident'
      ? 'text-gold1'
      : block.confidence === 'provisional'
        ? 'text-blue1'
        : 'text-grey1'
  return (
    <div className="bg-hextech-black/40 p-4 outline outline-icon/20 -outline-offset-2">
      <p className="text-xs uppercase tracking-widest text-grey1/80">
        {caption} · <span className={tone}>{block.confidence}</span>
      </p>
      <p className="mt-2 text-grey1">{block.answer}</p>
      <p className="mt-1 text-sm text-grey1/80">{block.basis}</p>
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

function MethodologyPage() {
  const s = Route.useLoaderData()
  const confidentWeighted = weightedBattlesFor(MAX_CONFIDENT_UNCERTAINTY)
  // A fresh database (local dev, a new staging box) has no votes at all. The
  // page still has to read like prose, so the figures drop out rather than
  // rendering "0 of the 0 rated skins".
  const rebuilt = day(s.refitAt)
  const hasRatings = s.ratedSkins > 0

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Methodology"
        title="How the rankings work"
        subtitle="Every skin starts at 1500. Every battle moves two numbers. This page is the full accounting: where the data comes from, how it is computed, and how much confidence it has earned."
        className="mb-4"
      />

      <section className="animate-fade-up mt-8 bg-blue5/30 p-5 outline outline-blue3/40 -outline-offset-2">
        <p className="text-grey1">
          SkinBattle ranks League of Legends skins from{' '}
          <b className="font-semibold text-gold1">votes cast by its visitors</b>
          . There is no editorial list, no critic score, and no paid placement.
          {rebuilt ? ` As of the last rating rebuild (${rebuilt}), the` : ' The'}{' '}
          rankings rest on{' '}
          <b className="font-semibold text-gold1">
            {n(s.battleEvents)} recorded votes
          </b>{' '}
          covering {n(s.ratedSkins)} of the {n(s.catalogSkins)} skins in the
          catalog.
        </p>
        {hasRatings && (
          <p className="mt-3 text-sm text-grey1/80">
            That is a median of{' '}
            <b className="font-semibold text-gold1">
              {n(s.medianBattles)} battles per rated skin
            </b>
            . It is not a lot, and the rest of this page is mostly about being
            straight with you about what that does and does not support.
          </p>
        )}
      </section>

      <div className="animate-fade-up mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Skins in catalog" value={n(s.catalogSkins)} />
        <Figure label="With battle data" value={n(s.ratedSkins)} />
        <Figure label="Votes recorded" value={n(s.battleEvents)} />
        <Figure
          label="Settled rankings"
          value={`${n(s.confidentSkins)}`}
        />
      </div>

      <Section title="Where the data comes from">
        <p>
          <b>The catalog</b> — every skin, its splash art, champion, release
          date, price and skin line — comes from Riot's own public data, synced
          automatically{day(s.catalogSyncedAt) ? ` (last sync ${day(s.catalogSyncedAt)})` : ''}{' '}
          and topped up from a committed facts snapshot
          {day(s.factsSnapshotAt) ? ` dated ${day(s.factsSnapshotAt)}` : ''}.
          SkinBattle does not hand-edit skin facts.
        </p>
        <p>
          <b>The opinions</b> come from exactly two places, and nothing else:
        </p>
        <p>
          <b>Head-to-Head.</b> Two skins, you pick one. One pick is one
          comparison between those two skins.
        </p>
        <p>
          <b>Tier Drop.</b> You sort a champion's skins into S through D. Every
          skin in a higher tier is read as beating every skin in a lower one;
          same-tier skins are a tie and contribute nothing. Because all of those
          comparisons come from one person in one sitting they are correlated,
          not independent, so a whole board is capped at about{' '}
          <b>8 effective comparisons</b> and any single skin on it at{' '}
          <b>3</b>. Ranking twelve skins does not count as sixty-six opinions.
        </p>
        <p>
          There are no star ratings and no bans. If you see a number on this
          site, it came from someone choosing one skin over another.
        </p>
      </Section>

      <Section title="Placements, basically">
        <p>
          Every skin starts at <b>1500</b>, with a wide uncertainty band of{' '}
          <b>± 350</b>. Think of a fresh account in ranked: the system has no
          idea how good it is yet, so placement games swing hard. A skin's first
          battles work exactly like that.
        </p>
        <p>
          As evidence piles up the band tightens, down to a floor of{' '}
          <b>± 60</b>. That ± is printed next to ratings across the site and it
          means what it says: a skin at 1480 ± 90 could plausibly sit anywhere
          in that range.
        </p>
      </Section>

      <Section title="Every battle moves both skins">
        <p>
          When you pick a winner, the winner takes rating points and the loser
          pays them. How many depends on two things:
        </p>
        <p>
          <b>How surprising the result is.</b> A favorite beating an underdog
          tells us almost nothing, so the numbers barely move. An upset is real
          information, and the system pays for it accordingly.
        </p>
        <p>
          <b>How settled each skin is.</b> A brand-new skin can swing by up to{' '}
          <b>64 points</b> in a single battle. A heavily-battled one barely
          twitches, around <b>16</b>. Fresh skins find their level fast;
          established ones do not get knocked around by one weird Tuesday. (Your
          own private ratings, the ones behind your Mirror, use a flat{' '}
          <b>K of 48</b> instead — you see each skin a handful of times, so they
          need to converge faster.)
        </p>
      </Section>

      <section className="animate-fade-up mt-12 bg-blue5/30 p-5 outline outline-blue3/40 -outline-offset-2">
        <h2 className="font-serif text-2xl font-bold text-blue1">
          A worked example: the upset
        </h2>
        <p className="mt-2 text-grey1">
          Elementalist Lux sits at 1620, mostly settled after dozens of battles
          (± 70). Pool Party Graves just hit the arena at 1430, still wobbly (±
          300). The math expects Lux to win about 3 times in 4. You pick Graves.
        </p>
        <div className="mt-4 space-y-2">
          <ExampleRow
            name="Pool Party Graves"
            before="1430"
            delta="+42"
            after="1472"
            note="New skin, surprising win: maximum learning, big jump."
          />
          <ExampleRow
            name="Elementalist Lux"
            before="1620"
            delta="−13"
            after="1607"
            note="Settled skin: one upset dents her, it does not define her."
          />
        </div>
        <p className="mt-4 text-sm text-grey1">
          If Lux had won instead she would have gained about 4 points and Graves
          would have dropped about 14. Expected results barely move the needle.
          Upsets are where rankings are made.
        </p>
      </section>

      <Section title="Your vote has weight. Literally.">
        <p>
          Battles you fight as a guest count at <b>half weight</b>. Sign in and
          every pick lands at <b>full strength</b>.
        </p>
        <p>
          Here is the part we are proud of: when a guest creates an account,
          their old votes are not stuck at half weight forever. The system keeps
          every battle ever fought and periodically re-reads the whole history,
          so past picks are upgraded retroactively. A week of anonymous swiping
          was not wasted.
        </p>
        <p>
          One more guard, because the biggest risk to a community ranking is one
          determined person: a single voter's influence on any one skin is
          capped at about <b>6 effective comparisons</b>. Past that, your votes
          still count as battles — they just stop moving that skin. You cannot
          farm a favorite up the table.
        </p>
      </Section>

      <Section title="The recount">
        <p>
          The instant +42s and −13s after each pick are a live scoreboard, tuned
          to answer you back immediately. Periodically the system does something
          slower and more serious: it replays <b>every vote ever recorded</b>{' '}
          and rebuilds the entire ranking from the full history.
        </p>
        <p>
          That recount is the official result. It irons out streaks, lucky
          matchups and ordering quirks the live updates drift on. It is also why
          a rating can shift on a day nobody battled that skin: the room got
          smarter about everyone.
        </p>
        <p className="text-sm text-grey1/80">
          For the stats-minded: live updates are Elo-style with a
          confidence-scaled K; the recount is a Bradley-Terry model fit by
          minorization-maximization over the raw match log, with one virtual win
          and one virtual loss per skin so undefeated skins stay finite, anchored
          so the field's geometric mean sits at 1500. Elo experience,
          Bradley-Terry truth.{rebuilt ? ` Last run ${rebuilt}.` : ''}
        </p>
      </Section>

      <Section title="What the ± actually is">
        <p>
          After a recount, a skin's band is set directly by how much evidence it
          has: <b>± 350 ÷ √(weighted votes)</b>, floored at ± 60. It is a sample
          size wearing different clothes, and it is the single most useful number
          on this site.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[24rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-widest text-grey1/80">
              <tr>
                <th className="py-2 pr-4 font-normal">Weighted votes</th>
                <th className="py-2 pr-4 font-normal">Band</th>
                <th className="py-2 font-normal">What it supports</th>
              </tr>
            </thead>
            <tbody className="text-grey1">
              {[
                ['1', '± 350', 'Nothing. This is the starting band.'],
                ['3', '± 202', 'A page worth showing. Not an order.'],
                [
                  `${confidentWeighted}`,
                  `± ${MAX_CONFIDENT_UNCERTAINTY}`,
                  `A stated winner, if ${MIN_CONFIDENT_VOTERS} people are behind it.`,
                ],
                ['34', '± 60', 'The floor. As settled as it gets.'],
              ].map(([votes, band, means]) => (
                <tr key={band} className="border-t border-icon/20">
                  <td className="py-2 pr-4 font-serif font-bold text-gold1">
                    {votes}
                  </td>
                  <td className="py-2 pr-4 font-serif font-bold text-gold2">
                    {band}
                  </td>
                  <td className="py-2">{means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Bands also widen again on their own. A skin nobody has battled in
          months drifts back toward ± 350 over about six months of silence, which
          is both honest — taste moves — and practical, because it puts that skin
          back in front of voters.
        </p>
        {s.tightestBand !== null && s.widestBand !== null && (
          <p className="text-sm text-grey1/80">
            Today the site's bands run from ± {n(s.tightestBand)} at the
            tightest to ± {n(s.widestBand)} at the widest.
          </p>
        )}
      </Section>

      <Section title="Three thresholds, and why they are not the same number">
        <p>
          There are three separate decisions here, and collapsing them into one
          number would be the easiest way to quietly start lying.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-widest text-grey1/80">
              <tr>
                <th className="py-2 pr-4 font-normal">Decision</th>
                <th className="py-2 pr-4 font-normal">Bar</th>
                <th className="py-2 font-normal">Question it answers</th>
              </tr>
            </thead>
            <tbody className="text-grey1">
              <tr className="border-t border-icon/20">
                <td className="py-2 pr-4">Show this page in search at all</td>
                <td className="py-2 pr-4 font-serif font-bold text-gold1">
                  {MIN_INDEXABLE_BATTLES} battles
                </td>
                <td className="py-2">Is there anything here yet?</td>
              </tr>
              <tr className="border-t border-icon/20">
                <td className="py-2 pr-4">State a winner on it</td>
                <td className="py-2 pr-4 font-serif font-bold text-gold1">
                  ± {MAX_CONFIDENT_UNCERTAINTY} band
                </td>
                <td className="py-2">Is the order real?</td>
              </tr>
              <tr className="border-t border-icon/20">
                <td className="py-2 pr-4">Call that winner the community's</td>
                <td className="py-2 pr-4 font-serif font-bold text-gold1">
                  {MIN_CONFIDENT_VOTERS} voters
                </td>
                <td className="py-2">Whose order is it?</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The <b>{MIN_INDEXABLE_BATTLES}-battle</b> bar is about crawl budget,
          not confidence. It keeps genuinely empty pages out of search results —
          a skin nobody has ever voted on has nothing to say. A ranking slice
          needs <b>{MIN_INDEXABLE_RATED} rated skins</b> for the same reason.
          Clearing that bar means a page exists, and nothing more.
        </p>
        <p>
          The <b>± {MAX_CONFIDENT_UNCERTAINTY}</b> bar is about whether the
          ranking can carry a sentence like "the best Ahri skin". Two skins whose
          ± {MAX_CONFIDENT_UNCERTAINTY} bands do not overlap sit roughly 200 Elo
          apart, which the model reads as a 76% win rate — a preference you would
          actually recognise. At the ± 202 band a {MIN_INDEXABLE_BATTLES}-battle
          skin carries, the same separation needs about 540 points, wider than
          most of the field. The order there is close to noise.
        </p>
        <p>
          So they are deliberately far apart: about{' '}
          <b>{confidentWeighted} weighted votes</b> for the second versus{' '}
          {MIN_INDEXABLE_BATTLES} raw battles for the first. Because a signed-out
          vote weighs half, {confidentWeighted} weighted votes means somewhere
          between {confidentWeighted} and {confidentWeighted * 2} real ones.
        </p>
        <p>
          The <b>{MIN_CONFIDENT_VOTERS}-voter</b> bar exists because the band
          cannot tell the difference between {confidentWeighted} votes from{' '}
          {confidentWeighted} people and {confidentWeighted} votes from one
          person having a long afternoon. Both produce ±{' '}
          {MAX_CONFIDENT_UNCERTAINTY}; only one of them is a community. The
          number is not a guess — a single voter's pull on any one skin is
          already capped at {VOTER_SKIN_CAP} weighted votes by the anti-farming
          rule, so the{' '}
          {confidentWeighted} weighted votes behind a ±{' '}
          {MAX_CONFIDENT_UNCERTAINTY} band cannot honestly come from fewer than{' '}
          {MIN_CONFIDENT_VOTERS} people. This bar enforces what the band was
          already claiming.
        </p>
        <p>
          <b>How a signed-out visitor counts.</b> As half a person, the same
          discount their vote already gets. Not because their opinion is worth
          less — it is the same click — but because we are counting{' '}
          <i>independence</i>, and a signed-out identity is a browser cookie:
          one visitor clearing theirs becomes several, one shared laptop makes
          several visitors one. Counting those at face value would let a
          determined afternoon manufacture a "community" verdict, which is the
          thing this bar exists to stop. Refusing to count them at all would be
          worse, because almost nobody signs in, and a site that runs on
          signed-out votes should not pretend it doesn't. So{' '}
          {MIN_CONFIDENT_VOTERS} members clear the bar, and so do{' '}
          {MIN_CONFIDENT_VOTERS * 2} signed-out visitors. That is a real
          weakness and this paragraph is where we admit it rather than hide it.
        </p>
        <p className="text-sm text-grey1/80">
          In code: <b>MIN_INDEXABLE_BATTLES</b> in{' '}
          <code className="text-gold2">lib/games/seo.ts</code> governs the robots
          tag and what enters the sitemap; <b>MAX_CONFIDENT_UNCERTAINTY</b> and{' '}
          <b>MIN_CONFIDENT_VOTERS</b> in{' '}
          <code className="text-gold2">lib/games/answer.ts</code> govern
          phrasing, and both must pass. They are different files on purpose.
        </p>
      </Section>

      <Section title="What the site will and will not say">
        <p>
          Ranking claims across the site are generated from live ratings by a
          fixed template — the same data always produces the same sentence, and
          no language model writes copy at request time. There are four
          versions, chosen by the band and the head count:
        </p>
        <div className="mt-4 space-y-3">
          <AnswerSample
            caption="Both bars cleared"
            scope="Ahri skins"
            leader={{
              name: 'Elderwood Ahri',
              rating: 1642,
              uncertainty: 62,
              battles: 41,
              voters: { members: 4, guests: 9 },
            }}
            rated={24}
            total={24}
          />
          <AnswerSample
            caption="Band outside the bar — today's normal case"
            scope="Ahri skins"
            leader={{
              name: 'Elderwood Ahri',
              rating: 1642,
              uncertainty: 210,
              battles: 4,
              voters: { members: 0, guests: 3 },
            }}
            rated={19}
            total={24}
          />
          <AnswerSample
            caption="Band inside the bar, too few people behind it"
            scope="Ahri skins"
            leader={{
              name: 'Elderwood Ahri',
              rating: 1642,
              uncertainty: 62,
              battles: 41,
              voters: { members: 1, guests: 1 },
            }}
            rated={24}
            total={24}
          />
          <AnswerSample
            caption="Nothing battled yet"
            scope="Ahri skins"
            leader={null}
            rated={0}
            total={24}
          />
        </div>
        <p className="mt-4 text-sm text-grey1/80">
          Worked examples, rendered by the same helper the rest of the site uses.
        </p>
      </Section>

      <Section title="Where the data is thin right now">
        <p>
          {hasRatings ? (
            <>
              Being blunt about it: <b>{n(s.confidentSkins)}</b> of the{' '}
              {n(s.ratedSkins)} skins with battle data currently sit inside the
              ± {MAX_CONFIDENT_UNCERTAINTY} band, and the median one has{' '}
              <b>{n(s.medianBattles)} battles</b>. That figure is the band
              alone; fewer pages than that are settled, because a settled
              verdict also needs {MIN_CONFIDENT_VOTERS} voters behind the
              leader, and votes on this site are concentrated in far fewer
              people than skins. So the provisional phrasing above is not an
              error state — at this stage it is the honest default, and most
              pages on the site use it.
            </>
          ) : (
            <>
              Being blunt about it: nothing has been battled yet, so every page
              is on the third template above. The provisional and confident
              phrasing arrive as votes do — in that order.
            </>
          )}
        </p>
        <p>
          That is a real limitation and it is the reason this page exists rather
          than a marketing claim about "the definitive skin ranking". The ratings
          are a live reading of what this community has voted so far. They are
          worth something, they are not a verdict, and the ± tells you which
          you are looking at.
        </p>
        <p>
          It also moves fast in the right direction: the band shrinks with the
          square root of the votes, so the first few dozen votes on a skin buy far
          more certainty than the next few hundred.
        </p>
      </Section>

      <Section title="Corrections">
        <p>
          Skin facts (prices, release dates, lines) come from Riot's public data
          and can be wrong or go stale. Ratings cannot be "corrected" — they are
          whatever the votes say — but if a skin's facts are wrong, or a page
          states something this methodology does not support, say so on the{' '}
          <Link to="/roadmap" className="text-gold2 underline">
            roadmap
          </Link>{' '}
          and it gets fixed.
        </p>
        <p className="text-sm text-grey1/80">
          SkinBattle is an independent fan project. It is not endorsed by Riot
          Games and does not sell skins.
        </p>
      </Section>

      <div className="animate-fade-up mt-14 flex flex-wrap items-center gap-3 border-t border-icon/20 pt-8">
        <p className="w-full text-grey1 sm:w-auto sm:flex-1">
          The model is hungry. Feed it.
        </p>
        <Link to="/battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Battle now
        </Link>
        <Link
          to="/rankings/$slice"
          params={{ slice: 'all' }}
          className={btnSecondarySm}
        >
          <FontAwesomeIcon icon={faFlaskVial} className="h-4" />
          See the rankings
        </Link>
      </div>
    </div>
  )
}
