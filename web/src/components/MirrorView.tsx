import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faChevronDown,
  faCircleInfo,
  faFilter,
  faFire,
  faPalette,
  faRankingStar,
  faScaleUnbalanced,
  faShirt,
  faShuffle,
  faTag,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { btnPrimarySm } from '~/lib/ui'
import { useAuth } from '~/lib/useAuth'
import { createSearcher } from '~/lib/search'
import type {
  ChampionCompletion,
  ContrarianTake,
  MirrorSkin,
  MirrorState,
  MirrorTier,
  TasteEntry,
  TierName,
} from '~/lib/games/types'

// The Mirror - the tier list your battles build. Lives on /profile (the
// profile IS the mirror); extracted as a view so the route stays a thin
// tab shell. Rendering is strictly read-only; the route's loader is what
// fetches state (peekUser - no user minted by looking).

// The sign-in nudge appears once the tier list is worth keeping (the design
// doc's ~20-battle conversion moment). Passive - nothing on this page gates.
const KEEP_IT_BATTLES = 20

const sectionCard =
  'bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-5 md:p-6'

const TIER_STYLE: Record<TierName, { label: string; tile: string }> = {
  S: { label: 'text-gold1', tile: 'outline-gold2/60' },
  A: { label: 'text-gold2', tile: 'outline-gold5/60' },
  B: { label: 'text-blue2', tile: 'outline-blue3/60' },
  C: { label: 'text-grey1', tile: 'outline-icon/30' },
  D: { label: 'text-danger', tile: 'outline-danger-border/40' },
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

// "Show names" preference - splash-only tiles by default; the name overlay is
// opt-in and persists across visits.
const NAMES_KEY = 'sb:mirror-show-names'

// Compact toolbar control, gold-lit while its state is active.
const toolbarChip = (active: boolean) =>
  `flex h-10 cursor-pointer items-center gap-2 px-3.5 text-sm transition duration-150 outline -outline-offset-1 ${
    active
      ? 'bg-gold5/25 text-gold1 outline-gold2/60'
      : 'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
  }`

function SkinTile({
  skin,
  tier,
  showName,
}: {
  skin: MirrorSkin
  tier: TierName
  showName: boolean
}) {
  return (
    <li
      title={`${skin.name} · ${skin.rating} · ${skin.battles} ${skin.battles === 1 ? 'battle' : 'battles'}`}
      className={`relative w-24 shrink-0 overflow-hidden bg-hextech-black/60 outline -outline-offset-1 transition duration-150 hover:outline-gold2 ${TIER_STYLE[tier].tile}`}
    >
      <Link to="/skins/$slug" params={{ slug: skin.slug }}>
        <img
          src={skin.splashUrl}
          alt={skin.name}
          loading="lazy"
          decoding="async"
          className="aspect-video w-full object-cover"
        />
      </Link>
      {showName && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-hextech-black/95 via-hextech-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-semibold leading-none text-gold1">
          {skin.name}
        </span>
      )}
    </li>
  )
}

function TierRow({
  tier,
  showNames,
  filtering,
}: {
  tier: MirrorTier
  showNames: boolean
  filtering: boolean
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div
        className={`flex w-12 shrink-0 items-center justify-center bg-hextech-black/60 font-serif text-2xl font-bold outline outline-icon/20 -outline-offset-2 ${TIER_STYLE[tier.tier].label}`}
      >
        {tier.tier}
      </div>
      <ul className="flex min-h-[62px] flex-1 flex-wrap content-start gap-1.5 bg-hextech-black/30 p-1.5 outline outline-icon/10 -outline-offset-1">
        {tier.skins.map((s) => (
          <SkinTile key={s.skinId} skin={s} tier={tier.tier} showName={showNames} />
        ))}
        {tier.skins.length === 0 && (
          <li className="flex h-[54px] items-center px-3 text-sm text-grey1/60">
            {filtering ? 'Nothing from the chosen champions' : 'No skins here yet'}
          </li>
        )}
      </ul>
    </div>
  )
}

interface ChampionOption {
  id: string
  name: string
  count: number
}

// Searchable multi-select over the champions present in the user's rated
// skins. Selection lives in the parent; empty selection means "show all".
function ChampionFilter({
  options,
  selected,
  onToggle,
  onClear,
}: {
  options: ChampionOption[]
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Close if clicked outside (same pattern as Dropdown.tsx).
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const searcher = useMemo(
    () => createSearcher(options, { keys: ['name'] }),
    [options],
  )
  const visible = useMemo(() => searcher.search(query), [searcher, query])
  const label =
    selected.size === 0
      ? 'All champions'
      : selected.size === 1
        ? (options.find((o) => selected.has(o.id))?.name ?? '1 champion')
        : `${selected.size} champions`

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={toolbarChip(selected.size > 0)}
      >
        <FontAwesomeIcon icon={faFilter} className="h-3.5" />
        <span className="max-w-40 truncate">{label}</span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`h-3 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-2 w-72 bg-hextech-black/95 shadow-2xl outline outline-gold2/30 -outline-offset-1 backdrop-blur">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search champions..."
            aria-label="Search champions"
            className="h-10 w-full border-b border-icon/20 bg-transparent px-3 text-sm text-gold1 placeholder:text-grey1/60 focus:outline-none"
          />
          <ul role="listbox" aria-multiselectable className="max-h-56 overflow-y-auto">
            {visible.map((o) => {
              const on = selected.has(o.id)
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => onToggle(o.id)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition duration-150 ${
                      on
                        ? 'bg-gold5/30 font-semibold text-gold1'
                        : 'text-grey1 hover:bg-grey-cool hover:text-gold1'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center outline -outline-offset-1 ${
                        on ? 'bg-gold5/40 outline-gold2/60' : 'outline-icon/40'
                      }`}
                    >
                      {on && <FontAwesomeIcon icon={faCheck} className="h-2.5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="shrink-0 text-xs text-grey1/70">
                      {o.count}
                    </span>
                  </button>
                </li>
              )
            })}
            {visible.length === 0 && (
              <li className="px-3 py-3 text-sm text-grey1/70">
                No champions match "{query}"
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={onClear}
            disabled={selected.size === 0}
            className="h-9 w-full cursor-pointer border-t border-icon/20 text-sm font-semibold text-gold2 transition duration-150 hover:bg-gold5/20 disabled:cursor-default disabled:text-grey1/50 disabled:hover:bg-transparent"
          >
            Clear filter
          </button>
        </div>
      )}
    </div>
  )
}

function TierListSection({ state }: { state: MirrorState }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [showNames, setShowNames] = useState(false)
  const [howOpen, setHowOpen] = useState(false)

  // Read the persisted preference in an effect so SSR and the first client
  // render agree (same pattern as the champions grid density).
  useEffect(() => {
    try {
      if (localStorage.getItem(NAMES_KEY) === '1') setShowNames(true)
    } catch {
      // Private mode / storage disabled: default stays off.
    }
  }, [])

  const toggleNames = () => {
    const next = !showNames
    setShowNames(next)
    try {
      localStorage.setItem(NAMES_KEY, next ? '1' : '0')
    } catch {
      // Private mode / storage disabled: the toggle still works for the visit.
    }
  }

  // Champions present in the rated skins, with how many tiles each holds.
  const options = useMemo<ChampionOption[]>(() => {
    const byId = new Map<string, ChampionOption>()
    for (const t of state.tiers)
      for (const s of t.skins) {
        const o = byId.get(s.championId) ?? {
          id: s.championId,
          name: s.championName,
          count: 0,
        }
        o.count += 1
        byId.set(s.championId, o)
      }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [state.tiers])

  const filtering = selected.size > 0
  const tiers = useMemo(
    () =>
      filtering
        ? state.tiers.map((t) => ({
            ...t,
            skins: t.skins.filter((s) => selected.has(s.championId)),
          }))
        : state.tiers,
    [state.tiers, selected, filtering],
  )

  const toggleChampion = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const clearChampions = () => setSelected(new Set())

  const shown = tiers.reduce((n, t) => n + t.skins.length, 0)
  const total = state.tiers.reduce((n, t) => n + t.skins.length, 0)

  return (
    <section className="animate-fade-up max-w-4xl">
      <SectionHeading
        icon={faRankingStar}
        title="Your tier list"
        sub={`Auto-built from ${state.totalBattles.toLocaleString()} battles. Only skins you've actually judged. Every battle sharpens it.`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ChampionFilter
          options={options}
          selected={selected}
          onToggle={toggleChampion}
          onClear={clearChampions}
        />
        {filtering && (
          <button
            type="button"
            onClick={clearChampions}
            className="flex h-10 cursor-pointer items-center gap-1.5 px-2 text-sm text-grey1 transition duration-150 hover:text-gold1"
          >
            <FontAwesomeIcon icon={faXmark} className="h-3.5" />
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={toggleNames}
          aria-pressed={showNames}
          className={toolbarChip(showNames)}
        >
          <FontAwesomeIcon icon={faTag} className="h-3.5" />
          Show names
        </button>
        <button
          type="button"
          onClick={() => setHowOpen(!howOpen)}
          aria-expanded={howOpen}
          aria-controls="tier-explainer"
          className={`ml-auto ${toolbarChip(howOpen)}`}
        >
          <FontAwesomeIcon icon={faCircleInfo} className="h-3.5" />
          How tiers work
        </button>
      </div>

      {howOpen && (
        <div
          id="tier-explainer"
          className="mb-3 max-w-2xl bg-hextech-black/30 p-4 text-sm leading-relaxed text-grey1 outline outline-icon/20 -outline-offset-1"
        >
          <p>
            Every pick you make in Head-to-Head updates a personal rating for
            the two skins you judged. Each skin starts at 1500. The one you
            pick gains points, and the one you pass on loses some.
          </p>
          <p className="mt-2">
            Tiers are fixed bands on that rating:{' '}
            <b className={TIER_STYLE.S.label}>S</b> is 1590 or higher,{' '}
            <b className={TIER_STYLE.A.label}>A</b> is 1520 to 1589,{' '}
            <b className={TIER_STYLE.B.label}>B</b> is 1480 to 1519,{' '}
            <b className={TIER_STYLE.C.label}>C</b> is 1410 to 1479, and{' '}
            <b className={TIER_STYLE.D.label}>D</b> is below 1410. The bands
            never move, so a skin only changes tier when its own rating does.
          </p>
        </div>
      )}

      {filtering && (
        <p className="mb-3 text-xs text-grey1">
          Showing {shown} of {total} rated {total === 1 ? 'skin' : 'skins'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {tiers.map((t) => (
          <TierRow key={t.tier} tier={t} showNames={showNames} filtering={filtering} />
        ))}
      </div>
    </section>
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
        <p className="truncate font-serif font-bold text-gold1">
          <Link
            to="/skins/$slug"
            params={{ slug: take.slug }}
            className="transition duration-150 hover:text-gold2"
          >
            {take.name}
          </Link>
        </p>
        <p className="truncate text-sm text-grey1">
          {take.championName} · You{' '}
          <b className="text-gold1">{take.personal}</b> · the room{' '}
          <b className="text-gold1">{take.community}</b> (#{take.communityRank})
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`font-serif text-xl font-bold ${hotter ? 'text-blue2' : 'text-danger'}`}
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
                className={`font-serif font-bold ${positive ? 'text-blue2' : 'text-danger'}`}
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

// What the mirror WILL become - never a blank page. Ghost tiers sketch the
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
            Every Head-to-Head pick rates the skins you saw, and the Mirror
            turns those picks into your personal tier list, your most
            contrarian takes, and the champions you secretly over-index on. No
            account needed. It starts with one battle.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link to="/battle" className={btnPrimarySm}>
              <FontAwesomeIcon icon={faShuffle} className="h-4" />
              Fight your first battle
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

// ─── view ───────────────────────────────────────────────────────────────────

function KeepItBanner({ battles }: { battles: number }) {
  const { login } = useAuth()
  return (
    <section className="mb-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-gold5/10 p-4 outline outline-gold2/40 -outline-offset-2">
      <p className="text-sm text-grey1 md:text-base">
        <FontAwesomeIcon icon={faFire} className="mr-2 h-4 text-gold2" />
        <b className="text-gold1">
          Your tier list is taking shape, {battles.toLocaleString()} battles
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

export default function MirrorView({ state }: { state: MirrorState }) {
  if (state.totalBattles === 0) return <EmptyMirror state={state} />

  return (
    <>
      {state.totalBattles > 0 && (
        <p className="animate-fade-up mb-8 text-sm text-grey1">
          <b className="text-gold1">{state.totalBattles.toLocaleString()}</b>{' '}
          battles ·{' '}
          <b className="text-gold1">{state.skinsRated.toLocaleString()}</b> of{' '}
          {state.catalogTotal.toLocaleString()} skins rated ·{' '}
          <b className="text-gold1">{state.championsTouched}</b> of{' '}
          {state.championsTotal} champions
        </p>
      )}

      {state.tier === 'guest' && state.totalBattles >= KEEP_IT_BATTLES && (
        <KeepItBanner battles={state.totalBattles} />
      )}

      <TierListSection state={state} />

      <section className="animate-fade-up mt-14 max-w-4xl">
        <SectionHeading
          icon={faScaleUnbalanced}
          title="Your most contrarian takes"
          sub="Where you and the community disagree the hardest, in both directions."
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
              least twice and the community has fought it at least 8 times.
              Keep battling and check back as the room fills in.
            </p>
          </div>
        )}
      </section>

      <section className="animate-fade-up mt-14 max-w-4xl">
        <SectionHeading
          icon={faPalette}
          title="Taste profile"
          sub="Skin lines and champions you rate well above or below your own average."
        />
        {state.tasteOver.length > 0 || state.tasteUnder.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TasteList
              title="You over-index on"
              entries={state.tasteOver}
              positive
              empty="No clear favorites yet. Battle more skins from the same champions."
            />
            <TasteList
              title="You under-index on"
              entries={state.tasteUnder}
              positive={false}
              empty="Nothing you're notably cold on, yet."
            />
          </div>
        ) : (
          <div className={`${sectionCard} max-w-2xl`}>
            <p className="text-sm text-grey1">
              Your profile needs at least two rated skins from the same
              skin line or champion before a pattern counts. Keep battling.
              The matchmaker will get you there.
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
        <Link to="/battle" className={btnPrimarySm}>
          <FontAwesomeIcon icon={faShuffle} className="h-4" />
          Keep battling
        </Link>
      </div>
    </>
  )
}
