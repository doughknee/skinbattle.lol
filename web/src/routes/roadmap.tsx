import { createFileRoute, Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowTrendUp,
  faAward,
  faCheck,
  faFire,
  faHeart,
  faLayerGroup,
  faMedal,
  faShuffle,
  faTrophy,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import ErrorState from '~/components/ErrorState'
import { fetchRoadmap } from '~/lib/games/serverFns'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

export const Route = createFileRoute('/roadmap')({
  loader: () => fetchRoadmap(),
  head: () => ({
    meta: [
      { title: 'Roadmap · Skin Battle' },
      {
        name: 'description',
        content:
          'What is live, what is coming, and the community milestones that unlock it. Every battle counts toward the next era.',
      },
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load the roadmap" message={error.message} />
  ),
  component: RoadmapPage,
})

// ─── building blocks ─────────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: string }) {
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

function Meter({
  title,
  detail,
  value,
  goal,
  gate,
}: {
  title: string
  detail: string
  value: number
  goal: number
  gate: string
}) {
  const pct = Math.max(0, Math.min(100, (value / goal) * 100))
  return (
    <div className="bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-serif text-lg font-bold text-gold1">{title}</h3>
        <p className="text-sm text-grey1">{detail}</p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={title}
        className="mt-3 h-3 bg-hextech-black/60 outline outline-icon/30 -outline-offset-1"
      >
        <div
          className="h-full bg-gradient-to-r from-gold5 to-gold2"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-gold2/90">{gate}</p>
    </div>
  )
}

function Teaser({
  icon,
  name,
  blurb,
}: {
  icon: IconDefinition
  name: string
  blurb: string
}) {
  return (
    <div className="flex gap-4 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
        <FontAwesomeIcon icon={icon} className="h-4.5 text-gold2" />
      </div>
      <div>
        <h3 className="font-serif text-lg font-bold text-gold1">{name}</h3>
        <p className="mt-1 text-sm text-grey1">{blurb}</p>
      </div>
    </div>
  )
}

function Era({
  kicker,
  title,
  gate,
  teasers,
}: {
  kicker: string
  title: string
  gate: string
  teasers: { icon: IconDefinition; name: string; blurb: string }[]
}) {
  return (
    <section className="animate-fade-up mt-14">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold2">
        {kicker}
      </p>
      <h2 className="mt-1 font-serif text-3xl font-bold text-gold1">{title}</h2>
      <p className="mt-2 max-w-2xl text-grey1">{gate}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {teasers.map((t) => (
          <Teaser key={t.name} {...t} />
        ))}
      </div>
    </section>
  )
}

// ─── live content ────────────────────────────────────────────────────────────

const LIVE_NOW: { label: string; to: string; params?: object }[] = [
  { label: 'Head-to-Head battles', to: '/battle' },
  { label: 'Splashdle', to: '/battle/splashdle' },
  { label: 'Price Point', to: '/battle/price-point' },
  { label: 'Chroma Vision', to: '/battle/chroma-vision' },
  { label: 'Leaderboards', to: '/battle/leaderboards' },
  { label: 'Your Mirror', to: '/profile' },
  {
    label: 'The full ranking, sliceable by price, line, champion, year',
    to: '/rankings/$slice',
    params: { slice: 'all' },
  },
  { label: 'The Drought Index', to: '/rankings/drought' },
]

const COMMUNITY_ERA = [
  {
    icon: faTrophy,
    name: 'The Skin Cup',
    blurb:
      'A monthly 64-skin bracket seeded by your battles: the community top 64, one matchup a day. Lock your bracket before round one and earn the eternal right to say you called it.',
  },
  {
    icon: faFire,
    name: 'Hot Takes',
    blurb:
      'One matchup a day, picked because the community is split right down the middle. Choose a side, then watch the argument settle in real numbers.',
  },
  {
    icon: faHeart,
    name: 'Wishlist Battles',
    blurb:
      'Which champion deserves the next skin more? The same battle engine, pointed at the future, building the definitive community skin wishlist.',
  },
  {
    icon: faLayerGroup,
    name: 'Daily Draft',
    blurb:
      'A themed prompt, a five-skin lineup, one day of voting. Best beach episode crew, max drip on a budget. The winning draft takes the front page.',
  },
]

const RANKED_ERA = [
  {
    icon: faMedal,
    name: 'Ranked divisions',
    blurb:
      'Climb from Iron to Challenger on your weekly performance. Seasons reset the ladder, never your identity: your tier list and completion are permanent.',
  },
  {
    icon: faAward,
    name: 'Season Awards',
    blurb:
      'The season finale. Best Splash, Biggest Cash Grab, Most Improved Wardrobe, decided in a live-voted ceremony week before the season archives forever.',
  },
  {
    icon: faArrowTrendUp,
    name: 'Higher or Lower: Community Mode',
    blurb:
      'Which skin does the community rate higher? You will be guessing against tens of thousands of real verdicts, and it will hurt.',
  },
  {
    icon: faWandMagicSparkles,
    name: 'Release Day Predictions',
    blurb:
      'A new skin line drops. Call where it settles in the rankings after two weeks, and build your reputation as a forecaster.',
  },
]

// ─── page ────────────────────────────────────────────────────────────────────

function RoadmapPage() {
  const stats = Route.useLoaderData()
  const n = (v: number) => v.toLocaleString('en-US')

  return (
    <div className="container mx-auto max-w-4xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Built in the open"
        title="The Roadmap"
        subtitle="Every battle you fight unlocks what comes next. Here is what is live, what is loading, and exactly how close we are."
        className="mb-10"
      />

      <section
        aria-label="Live community totals"
        className="animate-fade-up grid grid-cols-2 gap-3"
      >
        <StatChip label="Battles fought" value={n(stats.battles)} />
        <StatChip
          label="Skins rated"
          value={`${n(stats.ratedSkins)} / ${n(stats.totalSkins)}`}
        />
      </section>

      <section className="animate-fade-up mt-14">
        <h2 className="font-serif text-3xl font-bold text-gold1">
          Community milestones
        </h2>
        <p className="mt-2 max-w-2xl text-grey1">
          New features unlock on data, not dates. These meters move every time
          anyone, anywhere, picks a skin. Yes, including you, right now.
        </p>
        <div className="mt-5 flex flex-col gap-4">
          <Meter
            title="Every skin enters the arena"
            detail={`${n(stats.ratedSkins)} of ${n(stats.totalSkins)} skins have fought`}
            value={stats.ratedSkins}
            goal={stats.totalSkins}
            gate="The first quest: no skin left unrated."
          />
          <Meter
            title="Calibrated rankings"
            detail={`median ${n(stats.medianBattles)} of 10 battles per rated skin`}
            value={stats.medianBattles}
            goal={10}
            gate="Opens the Community Era: enough evidence per skin that brackets and hot takes are seeded by real verdicts."
          />
          <Meter
            title="100,000 battles fought"
            detail={`${n(stats.battles)} so far`}
            value={stats.battles}
            goal={100_000}
            gate="Opens the Ranked Era: rankings stable enough to compete on, predict against, and hand out awards for."
          />
        </div>
      </section>

      <section className="animate-fade-up mt-14">
        <h2 className="font-serif text-3xl font-bold text-gold1">
          Already live
        </h2>
        <p className="mt-2 text-grey1">
          Shipped, playable, and feeding the meters above.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {LIVE_NOW.map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                params={item.params as never}
                className="flex h-10 items-center gap-2 bg-hextech-black/40 px-4 text-sm font-bold text-gold1 outline outline-icon/30 -outline-offset-2 transition duration-150 hover:bg-gold5/30 hover:outline-gold2"
              >
                <FontAwesomeIcon icon={faCheck} className="h-3 text-blue2" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Era
        kicker="Next up"
        title="The Community Era"
        gate="Unlocks when the median rated skin has 10 battles and the arena feels busy. At that point the data is dense enough to seed brackets, surface genuinely divisive matchups, and let the community vote on more than pairs."
        teasers={COMMUNITY_ERA}
      />

      <Era
        kicker="On the horizon"
        title="The Ranked Era"
        gate="Unlocks when the rankings are stable enough to feel fair: 100,000 battles is the public milestone we are marching toward. Then the site stops just measuring taste and starts crowning it."
        teasers={RANKED_ERA}
      />

      <div className="animate-fade-up mt-16 flex flex-wrap items-center gap-3 border-t border-icon/20 pt-8">
        <p className="w-full text-grey1 sm:w-auto sm:flex-1">
          Every meter on this page moves one battle at a time.
        </p>
        <Link to="/battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Fight one now
        </Link>
        <Link to="/releases" className={btnSecondarySm}>
          What just shipped
        </Link>
      </div>
    </div>
  )
}
