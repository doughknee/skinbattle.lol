import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faFire,
  faPalette,
  faRankingStar,
  faScaleUnbalanced,
  faShirt,
  faShuffle,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { useAuth } from '~/lib/useAuth'
import { fetchMirror } from '~/lib/games/serverFns'
import { ogMeta } from '~/lib/games/ogMeta'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import type {
  ChampionCompletion,
  ContrarianTake,
  MirrorSkin,
  MirrorState,
  MirrorTier,
  TasteEntry,
  TierName,
} from '~/lib/games/types'

export const Route = createFileRoute('/games/mirror')({
  // Data loads BEFORE the route renders (SSR on first visit, prefetched on
  // navigation) — the whole reflection arrives with the page, no skeletons.
  // Viewing the mirror is strictly read-only on the server: no user is
  // minted, no row written.
  loader: () => fetchMirror({ data: { restoreToken: guestRestoreToken() } }),
  head: () => ({
    meta: [
      { title: 'The Mirror — Skin Battle' },
      {
        name: 'description',
        content:
          'Your personal League skin tier list, auto-built from your Quick Battle picks — plus your most contrarian takes and your taste profile.',
      },
      ...ogMeta({
        title: 'The Mirror — Skin Battle',
        description:
          'The personal tier list your battles build — plus your most contrarian takes.',
        card: 'mirror',
        path: '/games/mirror',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load your Mirror"
      message={error.message}
      back={{ to: '/games', label: 'Back to games' }}
    />
  ),
  component: MirrorPage,
})

// The sign-in nudge appears once the tier list is worth keeping (the design
// doc's ~20-battle conversion moment). Passive — nothing on this page gates.
const KEEP_IT_BATTLES = 20

const sectionCard =
  'bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-5 md:p-6'

const TIER_STYLE: Record<TierName, { label: string; tile: string }> = {
  S: { label: 'text-gold1', tile: 'outline-gold2/60' },
  A: { label: 'text-gold2', tile: 'outline-gold5/60' },
  B: { label: 'text-blue2', tile: 'outline-blue3/60' },
  C: { label: 'text-grey1', tile: 'outline-icon/30' },
  D: { label: 'text-red-300', tile: 'outline-red-400/40' },
}

function SectionHeading({
  icon,
  title,
  sub,
}: {
  icon: typeof faRankingStar
  title: string
  sub: string
}) {
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-3 font-serif text-2xl font-bold text-gold2">
        <FontAwesomeIcon icon={icon} className="h-5 text-gold2" />
        {title}
      </h2>
      <p className="mt-1 text-sm text-grey1">{sub}</p>
    </div>
  )
}

// ─── tier list ──────────────────────────────────────────────────────────────

function SkinTile({ skin, tier }: { skin: MirrorSkin; tier: TierName }) {
  return (
    <li
      title={`${skin.name} — ${skin.rating} · ${skin.battles} ${skin.battles === 1 ? 'battle' : 'battles'}`}
      className={`relative w-24 shrink-0 overflow-hidden bg-hextech-black/60 outline -outline-offset-1 ${TIER_STYLE[tier].tile}`}
    >
      <img
        src={skin.splashUrl}
        alt={skin.name}
        loading="lazy"
        decoding="async"
        className="aspect-video w-full object-cover"
      />
    </li>
  )
}

function TierRow({ tier }: { tier: MirrorTier }) {
  return (
    <div className="flex items-stretch gap-2">
      <div
        className={`flex w-12 shrink-0 items-center justify-center bg-hextech-black/60 font-serif text-2xl font-bold outline outline-icon/20 -outline-offset-2 ${TIER_STYLE[tier.tier].label}`}
      >
        {tier.tier}
      </div>
      <ul className="flex min-h-[62px] flex-1 flex-wrap content-start gap-1.5 bg-hextech-black/30 p-1.5 outline outline-icon/10 -outline-offset-1">
        {tier.skins.map((s) => (
          <SkinTile key={s.skinId} skin={s} tier={tier.tier} />
        ))}
        {tier.skins.length === 0 && (
          <li className="flex h-[54px] items-center px-3 text-sm text-grey1/60">
            No skins here yet
          </li>
        )}
      </ul>
    </div>
  )
}

// ─── contrarian takes ───────────────────────────────────────────────────────

function TakeRow({ take }: { take: ContrarianTake }) {
  const hotter = take.gap > 0
  return (
    <li className="flex items-center gap-4 bg-hextech-black/30 p-3 outline outline-icon/10 -outline-offset-1">
      <img
        src={take.splashUrl}
        alt={take.name}
        loading="lazy"
        decoding="async"
        className="aspect-video w-28 shrink-0 object-cover outline outline-icon/20 -outline-offset-1"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif font-bold text-gold1">{take.name}</p>
        <p className="truncate text-sm text-grey1">
          {take.championName} · You{' '}
          <b className="text-gold1">{take.personal}</b> · the room{' '}
          <b className="text-gold1">{take.community}</b> (#{take.communityRank})
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`font-serif text-xl font-bold ${hotter ? 'text-blue2' : 'text-red-300'}`}
        >
          {hotter ? '+' : '−'}
          {Math.abs(take.gap)}
        </p>
        <p className="text-xs text-grey1">
          {hotter ? 'hotter than the room' : 'colder than the room'}
        </p>
      </div>
    </li>
  )
}

// ─── taste profile ──────────────────────────────────────────────────────────

function TasteList({
  title,
  entries,
  positive,
  empty,
}: {
  title: string
  entries: TasteEntry[]
  positive: boolean
  empty: string
}) {
  return (
    <div className={sectionCard}>
      <h3 className="mb-3 font-serif text-lg font-bold text-gold1">{title}</h3>
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} className="flex h-9 items-baseline gap-3">
              <span className="min-w-0 truncate font-bold text-gold1">
                {e.name}
              </span>
              <span className="shrink-0 text-xs uppercase tracking-wider text-grey1/70">
                {e.kind === 'line' ? 'skin line' : 'champion'}
              </span>
              <span
                className={`font-serif font-bold ${positive ? 'text-blue2' : 'text-red-300'}`}
              >
                {positive ? '+' : '−'}
                {Math.abs(e.delta)}
              </span>
              <span className="ml-auto shrink-0 text-sm text-grey1">
                {e.skinsRated} skins rated
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-grey1">{empty}</p>
      )}
    </div>
  )
}

// ─── wardrobe completion ────────────────────────────────────────────────────

function CompletionBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((100 * value) / max) : 0
  return (
    <div className="h-1.5 w-full bg-hextech-black/60 outline outline-icon/20 -outline-offset-1">
      <div className="h-full bg-gold2" style={{ width: `${pct}%` }} />
    </div>
  )
}

function ChampionRow({ c }: { c: ChampionCompletion }) {
  return (
    <li className="flex h-12 flex-col justify-center gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-bold text-gold1">
          {c.championName}
        </span>
        <span className="shrink-0 text-sm text-grey1">
          {c.rated}/{c.total}
        </span>
      </div>
      <CompletionBar value={c.rated} max={c.total} />
    </li>
  )
}

// ─── empty state ────────────────────────────────────────────────────────────

// What the mirror WILL become — never a blank page. Ghost tiers sketch the
// shape; the CTA points at the loop that fills it. No user is minted by
// being here.
const GHOST_TILES: Record<TierName, number> = { S: 2, A: 4, B: 5, C: 3, D: 2 }

function EmptyMirror({ state }: { state: MirrorState }) {
  return (
    <>
      <section className={`${sectionCard} animate-fade-up max-w-3xl`}>
        <div className="pointer-events-none flex flex-col gap-2 opacity-50" aria-hidden>
          {(Object.keys(GHOST_TILES) as TierName[]).map((t) => (
            <div key={t} className="flex items-stretch gap-2">
              <div
                className={`flex w-12 shrink-0 items-center justify-center bg-hextech-black/60 font-serif text-2xl font-bold outline outline-icon/20 -outline-offset-2 ${TIER_STYLE[t].label}`}
              >
                {t}
              </div>
              <div className="flex min-h-[62px] flex-1 flex-wrap content-start gap-1.5 bg-hextech-black/30 p-1.5 outline outline-icon/10 -outline-offset-1">
                {Array.from({ length: GHOST_TILES[t] }, (_, i) => (
                  <div
                    key={i}
                    className="flex aspect-video w-24 items-center justify-center bg-hextech-black/50 font-serif text-lg font-bold text-grey1/40 outline outline-icon/10 -outline-offset-1"
                  >
                    ?
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <h2 className="font-serif text-2xl font-bold text-gold1">
            This is where your taste takes shape
          </h2>
          <p className="mt-2 max-w-xl text-grey1">
            Every Quick Battle pick rates the skins you saw — and the Mirror
            turns those picks into your personal tier list, your most
            contrarian takes, and the champions you secretly over-index on. No
            account needed. It starts with one battle.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link to="/games/quick-battle" className={btnPrimarySm}>
              <FontAwesomeIcon icon={faShuffle} className="h-4" />
              Fight your first battle
            </Link>
            <Link to="/games" className={btnSecondarySm}>
              <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
              Daily Hub
            </Link>
          </div>
        </div>
      </section>

      <section className="animate-fade-up mt-10 max-w-3xl">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-grey1">
            Wardrobe: <b className="text-gold1">0</b> of{' '}
            {state.catalogTotal.toLocaleString()} skins rated
          </p>
          <p className="text-sm text-grey1">
            0 of {state.championsTotal} champions touched
          </p>
        </div>
        <div className="mt-2">
          <CompletionBar value={0} max={state.catalogTotal} />
        </div>
      </section>
    </>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

function KeepItBanner({ battles }: { battles: number }) {
  const { login } = useAuth()
  return (
    <section className="mb-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-gold5/10 p-4 outline outline-gold2/40 -outline-offset-2">
      <p className="text-sm text-grey1 md:text-base">
        <FontAwesomeIcon icon={faFire} className="mr-2 h-4 text-gold2" />
        <b className="text-gold1">
          Your tier list is taking shape — {battles.toLocaleString()} battles
          in.
        </b>{' '}
        Right now it lives in this browser. Create an account to keep it.
      </p>
      <button onClick={login} className={btnPrimarySm}>
        Keep my tier list
      </button>
    </section>
  )
}

function MirrorPage() {
  const state = Route.useLoaderData()

  // Mirror the guest token to localStorage as a cookie backup.
  useEffect(() => {
    rememberGuestToken(state.guestToken)
  }, [state.guestToken])

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Your taste, reflected
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
            The M<span className="italic">irror</span>
          </h1>
          {state.totalBattles > 0 && (
            <p className="text-sm text-grey1">
              <b className="text-gold1">{state.totalBattles.toLocaleString()}</b>{' '}
              battles ·{' '}
              <b className="text-gold1">{state.skinsRated.toLocaleString()}</b>{' '}
              of {state.catalogTotal.toLocaleString()} skins rated ·{' '}
              <b className="text-gold1">{state.championsTouched}</b> of{' '}
              {state.championsTotal} champions
            </p>
          )}
        </div>
      </header>

      {state.totalBattles === 0 ? (
        <EmptyMirror state={state} />
      ) : (
        <>
          {state.tier === 'guest' && state.totalBattles >= KEEP_IT_BATTLES && (
            <KeepItBanner battles={state.totalBattles} />
          )}

          <section className="animate-fade-up max-w-4xl">
            <SectionHeading
              icon={faRankingStar}
              title="Your tier list"
              sub={`Auto-built from ${state.totalBattles.toLocaleString()} battles — only skins you've actually judged. Every battle sharpens it.`}
            />
            <div className="flex flex-col gap-2">
              {state.tiers.map((t) => (
                <TierRow key={t.tier} tier={t} />
              ))}
            </div>
          </section>

          <section className="animate-fade-up mt-14 max-w-4xl">
            <SectionHeading
              icon={faScaleUnbalanced}
              title="Your most contrarian takes"
              sub="Where you and the community disagree the hardest — both directions."
            />
            {state.contrarian.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {state.contrarian.map((t) => (
                  <TakeRow key={t.skinId} take={t} />
                ))}
              </ul>
            ) : (
              <div className={`${sectionCard} max-w-2xl`}>
                <p className="text-sm text-grey1">
                  No verdicts yet. A take counts once you've fought a skin at
                  least twice and the community has fought it at least 8 times
                  — keep battling and check back as the room fills in.
                </p>
              </div>
            )}
          </section>

          <section className="animate-fade-up mt-14 max-w-4xl">
            <SectionHeading
              icon={faPalette}
              title="Taste profile"
              sub="Skin lines and champions you rate well above — or below — your own average."
            />
            {state.tasteOver.length > 0 || state.tasteUnder.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TasteList
                  title="You over-index on"
                  entries={state.tasteOver}
                  positive
                  empty="No clear favorites yet — battle more skins from the same champions."
                />
                <TasteList
                  title="You under-index on"
                  entries={state.tasteUnder}
                  positive={false}
                  empty="Nothing you're notably cold on — yet."
                />
              </div>
            ) : (
              <div className={`${sectionCard} max-w-2xl`}>
                <p className="text-sm text-grey1">
                  Your profile needs at least two rated skins from the same
                  skin line or champion before a pattern counts. Keep battling
                  — the matchmaker will get you there.
                </p>
              </div>
            )}
          </section>

          <section className="animate-fade-up mt-14 max-w-4xl">
            <SectionHeading
              icon={faShirt}
              title="Wardrobe completion"
              sub={`Rated ${state.skinsRated.toLocaleString()} of ${state.catalogTotal.toLocaleString()} skins across the catalog.`}
            />
            <div className="mb-6 max-w-2xl">
              <CompletionBar value={state.skinsRated} max={state.catalogTotal} />
            </div>
            <ul className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {state.completion.map((c) => (
                <ChampionRow key={c.championId} c={c} />
              ))}
            </ul>
            {state.completionMore > 0 && (
              <p className="mt-3 text-sm text-grey1">
                …and {state.completionMore} more champions you've touched.
              </p>
            )}
          </section>

          <div className="mt-12 flex flex-wrap items-center gap-3">
            <Link to="/games/quick-battle" className={btnPrimarySm}>
              <FontAwesomeIcon icon={faShuffle} className="h-4" />
              Keep battling
            </Link>
            <Link to="/games" className={btnSecondarySm}>
              <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
              Daily Hub
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
