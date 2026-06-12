import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faFlaskVial,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

// A plain-language tour of the rating engine in lib/games/server/ratings.ts.
// Every number on this page (1500, 350, 60, the 16-64 swing, half-weight
// guests, the median-10 calibration bar) mirrors a constant there. If the
// engine's parameters change, change this copy with them.

export const Route = createFileRoute('/rankings/elo')({
  head: () => ({
    meta: [
      { title: 'How the Rankings Work · Skin Battle' },
      {
        name: 'description',
        content:
          'Every skin starts at 1500. Every battle moves two numbers. Here is how your picks become the community skin ranking, explained for League players.',
      },
    ],
  }),
  component: HowRankingsWorkPage,
})

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

function HowRankingsWorkPage() {
  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Rankings"
        title="How the rankings work"
        subtitle="Every skin starts at 1500. Every battle moves two numbers. Everything else is detail, and the details are fun."
        className="mb-4"
      />

      <Section title="Placements, basically">
        <p>
          Every one of the ~1,900 skins starts at <b>1500</b>, with a big
          uncertainty band of <b>± 350</b>. Think of a fresh account in ranked:
          the system has no idea how good it is yet, so placement games swing
          hard. A skin's first battles work exactly like that.
        </p>
        <p>
          As evidence piles up, the band tightens, down to a floor of{' '}
          <b>± 60</b>. That ± number is shown everywhere on the rankings, and it
          means what it says: a skin at 1480 ± 90 could plausibly sit anywhere
          in that range. The ranking is honest about what it knows.
        </p>
      </Section>

      <Section title="Every battle moves both skins">
        <p>
          When you pick a winner in a battle, the winner takes rating points
          and the loser pays them. How many depends on two things:
        </p>
        <p>
          <b>How surprising the result is.</b> A favorite beating an underdog
          tells us almost nothing, so the numbers barely move. An upset is real
          information, and the system rewards it accordingly.
        </p>
        <p>
          <b>How settled each skin is.</b> A brand-new skin can swing by up to
          64 points in a single battle. A skin with hundreds of battles barely
          twitches, around 16 at most. Fresh skins find their level fast;
          established ones do not get knocked around by one weird Tuesday.
        </p>
      </Section>

      <section className="animate-fade-up mt-12 bg-blue5/30 p-5 outline outline-blue3/40 -outline-offset-2">
        <h2 className="font-serif text-2xl font-bold text-blue1">
          A worked example: the upset
        </h2>
        <p className="mt-2 text-grey1">
          Elementalist Lux sits at 1620, mostly settled after dozens of battles
          (± 70). Pool Party Graves just hit the arena at 1430, still wobbly
          (± 300). The math expects Lux to win about 3 times in 4. You pick
          Graves.
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
          If Lux had won instead, she would have gained about 4 points and
          Graves would have dropped about 14. Expected results barely move the
          needle. Upsets are where rankings are made.
        </p>
      </section>

      <Section title="Your vote has weight. Literally.">
        <p>
          Battles you fight as a guest count at <b>half weight</b>. Sign in and
          every pick lands at <b>full strength</b>.
        </p>
        <p>
          Here is the part we are proud of: when a guest creates an account,
          their old votes are not stuck at half weight forever. The system
          keeps every battle ever fought and periodically re-reads the whole
          history, so your past picks get upgraded to full weight
          retroactively. Your week of anonymous swiping was not wasted. It was
          an investment.
        </p>
      </Section>

      <Section title='Why some lists say "still calibrating"'>
        <p>
          A ranking earns full confidence once the typical skin on it has{' '}
          <b>10 battles</b>. Below that, we show the list anyway, banner and
          all, because thin data is not something to hide. It is something to
          fix, and every battle you fight fixes it a little.
        </p>
        <p>
          Skins with very few battles also wear an "early ranking" tag on their
          own pages. Same idea: the number is real, the confidence is not there
          yet.
        </p>
      </Section>

      <Section title="The recount">
        <p>
          The instant +42s and −13s you see after each pick are the live
          scoreboard, tuned to answer you back immediately. Every few hundred
          battles, the system also does something slower and more serious: it
          replays <b>every battle ever recorded</b> from scratch and rebuilds
          the entire ranking from the full history.
        </p>
        <p>
          That recount is the official result. It irons out streaks, lucky
          matchups, and ordering quirks that live updates can drift on. It is
          also why a skin's rating can shift slightly even on a day nobody
          battled it: the room got smarter about everyone.
        </p>
        <p className="text-sm text-grey1/80">
          For the stats nerds: the live updates are Elo-style, the recount is a
          Bradley-Terry model fit over the raw battle log. Elo experience,
          Bradley-Terry truth.
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
