import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  animate,
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
  useSpring,
  type DOMKeyframesDefinition,
} from 'motion/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faBolt,
  faCheck,
  faCircleCheck,
  faCrown,
  faDice,
  faDownload,
  faFire,
  faImage,
  faLayerGroup,
  faLink,
  faMagnifyingGlass,
  faMagnifyingGlassPlus,
  faRotate,
  faShareNodes,
  faUsers,
  faVolumeHigh,
  faVolumeXmark,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import TodayStrip from '~/components/games/TodayStrip'
import { toast } from '~/components/Toaster'
import { openLightbox } from '~/components/Lightbox'
import { AnimatedNumber } from '~/components/games/AnimatedNumber'
import { ogMeta } from '~/lib/games/ogMeta'
import {
  createTierShare,
  fetchDailyHub,
  fetchSharedTierList,
  fetchTierList,
  fetchTierScopes,
  submitTierList,
} from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import {
  playPlace,
  playPop,
  playSubmit,
  setSoundEnabled,
} from '~/lib/games/tierSound'
import type { ShareMode } from '~/lib/games/share'
import type {
  DailyHubState,
  SharedRankingRow,
  SharedTierListState,
  SubmittedTierList,
  TierBoard,
  TierListResult,
  TierListSkin,
  TierListState,
  TierName,
  TierResultRow,
  TierScopeCatalog,
  TierScopeOption,
} from '~/lib/games/types'

export const Route = createFileRoute('/battle/tier-drop')({
  validateSearch: (s: Record<string, unknown>): { s?: string; set?: string } => ({
    ...(typeof s.s === 'string' ? { s: s.s } : {}),
    ...(typeof s.set === 'string' ? { set: s.set } : {}),
  }),
  loaderDeps: ({ search }) => ({ s: search.s, set: search.set }),
  loader: async ({ deps }) => {
    const restoreToken = guestRestoreToken()
    if (deps.s) {
      return {
        kind: 'shared' as const,
        shared: await fetchSharedTierList({ data: { id: deps.s, restoreToken } }),
      }
    }
    // `set` (a boardId) means a picked/random board to play; absent = the menu.
    // The hub powers the "more ways to play" strip at the bottom.
    const [state, hub] = await Promise.all([
      fetchTierList({ data: { restoreToken, boardId: deps.set } }),
      fetchDailyHub({ data: { restoreToken } }),
    ])
    return { kind: 'normal' as const, state, hub }
  },
  head: ({ loaderData }) => {
    const shared = loaderData?.kind === 'shared' ? loaderData.shared : null
    // A shared ranking (reveal/hide) gets a per-share preview image; a
    // board-only share or the normal page falls back to the generic card.
    const hasImage = !!shared?.found && shared.mode !== 'board'
    const title =
      shared?.found && shared.sharerName
        ? `${shared.sharerName}'s tier list · Skin Battle`
        : 'Tier Drop · Skin Battle'
    const description =
      "Sort a champion's skins S to D, then see how your take stacks up against the community."
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        ...ogMeta({
          title,
          description,
          path: hasImage
            ? `/battle/tier-drop?s=${shared!.shareId}`
            : '/battle/tier-drop',
          ...(hasImage
            ? { imagePath: `/og/tierlist/${shared!.shareId}` }
            : { card: 'tier-list' as const }),
        }),
      ],
    }
  },
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load a tier list"
      message={error.message}
      back={{ to: '/battle', label: 'Back to Battle' }}
    />
  ),
  component: TierListPage,
})

const TIERS: TierName[] = ['S', 'A', 'B', 'C', 'D']
const MIN_PLACED = 4

// Classic tier colors, kept muted enough to sit on the hextech canvas.
const TIER_TONE: Record<TierName, string> = {
  S: 'bg-[#c8423a] text-white',
  A: 'bg-[#d98a2b] text-hextech-black',
  B: 'bg-[#3fa05a] text-hextech-black',
  C: 'bg-[#3a78c8] text-white',
  D: 'bg-[#565a63] text-white',
}

type Placed = Record<TierName, string[]>
const emptyPlaced = (): Placed => ({ S: [], A: [], B: [], C: [], D: [] })
// Restore a saved (partial) ranking into the full S–D shape the builder uses.
const tiersToPlaced = (tiers: Partial<Record<TierName, string[]>>): Placed => ({
  S: tiers.S ?? [],
  A: tiers.A ?? [],
  B: tiers.B ?? [],
  C: tiers.C ?? [],
  D: tiers.D ?? [],
})

type ShareInput = {
  boardId: string
  tiers?: Partial<Record<TierName, string[]>> | null
  name?: string
  mode: ShareMode
}

// ─── builder ─────────────────────────────────────────────────────────────────

// A draggable, zoomable skin tile. Drag to rank (motion handles the lift +
// FLIP via layoutId); tap to open the zoom modal. `onDrag`/`onDrop` report the
// pointer position so the Builder can hit-test which tier it's over.
function DraggableTile({
  skin,
  onZoom,
  onPickUp,
  onDrag,
  onDrop,
  locked = false,
  compare,
}: {
  skin: TierListSkin
  onZoom: () => void
  onPickUp?: () => void
  onDrag: (point: { x: number; y: number }) => void
  onDrop: (point: { x: number; y: number }) => void
  locked?: boolean
  compare?: TierResultRow
}) {
  const reduce = useReducedMotion()
  // motion fires onTap on the same pointer-up that ends a drag, so a drop would
  // also open the zoom. Flag a drag and skip the tap that follows it.
  const draggedRef = useRef(false)
  // The border lives on an overlay painted ABOVE the splash (see below), so the
  // hover image-zoom — whose transform makes a new stacking context — can't paint
  // over it and clip the border. Results mode colors it by agreement (green =
  // matched the crowd, amber = close, red = hot take); build mode is a thin
  // gold-on-hover outline.
  const agree = compare ? compare.communityTier === compare.yourTier : false
  const ringClass = !compare
    ? 'outline outline-icon/25 -outline-offset-2 transition-[outline-color] duration-150 group-hover:outline-gold2'
    : `outline outline-2 -outline-offset-2 ${
        compare.hotTake
          ? 'outline-[#c8423a]'
          : agree
            ? 'outline-[#3fa05a]'
            : 'outline-[#d98a2b]'
      }`
  return (
    <motion.button
      layout={!locked}
      layoutId={skin.skinId}
      drag={!locked}
      dragSnapToOrigin
      dragElastic={0.12}
      onDragStart={locked ? undefined : () => {
        draggedRef.current = true
        // Measure the drop zones once, now — they don't move during a drag, so
        // the per-move hit-test reads from the cache instead of re-measuring
        // every zone each frame.
        onPickUp?.()
      }}
      onDrag={locked ? undefined : (_, info) => onDrag(info.point)}
      onDragEnd={
        locked
          ? undefined
          : (_, info) => {
              onDrop(info.point)
              // Clear next frame, after the trailing onTap has been suppressed.
              requestAnimationFrame(() => {
                draggedRef.current = false
              })
            }
      }
      onTap={() => {
        if (!draggedRef.current) onZoom()
      }}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      whileDrag={
        locked || reduce
          ? undefined
          : {
              scale: 1.12,
              rotate: -3,
              zIndex: 60,
              cursor: 'grabbing',
              boxShadow: '0 12px 28px rgba(0,0,0,0.55)',
            }
      }
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      className={`group relative aspect-square w-[4.5rem] shrink-0 overflow-hidden bg-hextech-black/60 md:w-20 ${
        locked ? 'cursor-pointer' : 'cursor-grab touch-none'
      }`}
      title={
        compare
          ? `${skin.name}: you ${compare.yourTier}, community ${compare.communityTier}`
          : `${skin.name}: drag to rank, tap to zoom`
      }
    >
      <img
        src={skin.splashUrl}
        alt={skin.name}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="pointer-events-none h-full w-full object-cover transition duration-300 group-hover:scale-105"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-hextech-black/95 to-transparent px-1 pb-0.5 pt-3 text-[10px] font-bold leading-tight text-gold1">
        {skin.name}
      </span>
      {/* Border overlay — painted above the splash so a hover zoom can't clip it. */}
      <span aria-hidden className={`pointer-events-none absolute inset-0 ${ringClass}`} />
      {compare ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.12 }}
          title={`Community tier: ${compare.communityTier}`}
          className={`pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 px-1.5 py-0.5 font-serif text-[11px] font-bold leading-none shadow-md ${TIER_TONE[compare.communityTier]}`}
        >
          {compare.hotTake && <FontAwesomeIcon icon={faBolt} className="h-2.5" />}
          {compare.communityTier}
        </motion.span>
      ) : (
        <span className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-hextech-black/70 text-[10px] text-gold2 opacity-0 transition duration-150 group-hover:opacity-100">
          <FontAwesomeIcon icon={faMagnifyingGlassPlus} />
        </span>
      )}
    </motion.button>
  )
}

function TierListPage() {
  const data = Route.useLoaderData()
  const { set } = Route.useSearch()
  if (data.kind === 'shared') return <SharedTierList shared={data.shared} />
  // `?set=<boardId>` → play that board; no param → the menu. Driving mode from
  // the URL is what makes the navbar "Tier List" link return here from a board.
  if (set) {
    return (
      <Builder
        key={set}
        initialBoard={data.state.board}
        initialSubmitted={data.state.submitted}
        hub={data.hub}
      />
    )
  }
  return <TierListLanding state={data.state} hub={data.hub} />
}

// Battle › Tier List › [set] — the last crumb links back to the menu, so the
// path out of a board is always one click (and matches the navbar link).
function TierBreadcrumb({ current }: { current?: string }) {
  return (
    <nav className="mb-5 flex items-center gap-2 text-xs font-semibold text-grey1">
      <Link to="/battle" className="transition-colors hover:text-gold1">
        Battle
      </Link>
      <span className="text-icon/40">/</span>
      {current ? (
        <Link
          to="/battle/tier-drop"
          className="transition-colors hover:text-gold1"
        >
          Tier Drop
        </Link>
      ) : (
        <span className="text-gold2">Tier Drop</span>
      )}
      {current && (
        <>
          <span className="text-icon/40">/</span>
          <span className="truncate text-gold2">{current}</span>
        </>
      )}
    </nav>
  )
}

// ─── landing ─────────────────────────────────────────────────────────────────

type ReelItem = TierScopeOption & {
  axis: 'champion' | 'line' | 'year' | 'price' | 'rarity'
}
const AXIS_LABEL: Record<ReelItem['axis'], string> = {
  champion: 'Champion',
  line: 'Skin line',
  year: 'Year',
  price: 'Price',
  rarity: 'Rarity',
}
const AXIS_TONE: Record<ReelItem['axis'], string> = {
  champion: 'border-gold2/60 text-gold1',
  line: 'border-blue3/60 text-blue1',
  year: 'border-[#3fa05a]/70 text-[#7fd49a]',
  price: 'border-[#d98a2b]/70 text-[#e8b365]',
  rarity: 'border-[#a25afd]/70 text-[#c9a3f0]',
}
const allScopes = (s: TierScopeCatalog): ReelItem[] => [
  ...s.champions.map((o) => ({ ...o, axis: 'champion' as const })),
  ...s.lines.map((o) => ({ ...o, axis: 'line' as const })),
  ...s.years.map((o) => ({ ...o, axis: 'year' as const })),
  ...s.prices.map((o) => ({ ...o, axis: 'price' as const })),
  ...s.rarities.map((o) => ({ ...o, axis: 'rarity' as const })),
]

// The page opens on this menu — today's set, make-your-own, or a random spin —
// rather than dropping you straight into a board. Choosing one navigates to
// `?set=<boardId>`, so the URL (and the navbar/breadcrumb) reflect the board.
function TierListLanding({
  state,
  hub,
}: {
  state: TierListState
  hub: DailyHubState
}) {
  const navigate = useNavigate()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scopes, setScopes] = useState<TierScopeCatalog | null>(null)
  const [scopesLoading, setScopesLoading] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const [casing, setCasing] = useState<{
    target: ReelItem
    scopes: TierScopeCatalog
  } | null>(null)

  // Pointer-driven 3D tilt for the hero daily card (off under reduced motion).
  const reduce = useReducedMotion()
  const dailyRef = useRef<HTMLButtonElement>(null)
  const tiltX = useSpring(0, { stiffness: 200, damping: 22 })
  const tiltY = useSpring(0, { stiffness: 200, damping: 22 })
  const onDailyTilt = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const el = dailyRef.current
      if (reduce || !el) return
      const r = el.getBoundingClientRect()
      const TILT = 6 // degrees — subtle on a wide, short card
      tiltX.set(TILT * (0.5 - (e.clientY - r.top) / r.height))
      tiltY.set(TILT * ((e.clientX - r.left) / r.width - 0.5))
    },
    [reduce, tiltX, tiltY],
  )
  const resetDailyTilt = useCallback(() => {
    tiltX.set(0)
    tiltY.set(0)
  }, [tiltX, tiltY])

  const ensureScopes = useCallback(async (): Promise<TierScopeCatalog | null> => {
    if (scopes) return scopes
    setScopesLoading(true)
    try {
      const s = await fetchTierScopes()
      setScopes(s)
      return s
    } catch {
      toast("Couldn't load the sets. Try again.", 'error')
      return null
    } finally {
      setScopesLoading(false)
    }
  }, [scopes])

  const go = useCallback(
    (boardId: string) => {
      setNavigating(true)
      void navigate({ to: '/battle/tier-drop', search: { set: boardId } })
    },
    [navigate],
  )

  const openPicker = useCallback(async () => {
    setPickerOpen(true)
    await ensureScopes()
  }, [ensureScopes])

  const startRandom = useCallback(async () => {
    const s = await ensureScopes()
    if (!s) return
    const pool = allScopes(s)
    if (pool.length === 0) return
    setCasing({ target: pool[Math.floor(Math.random() * pool.length)], scopes: s })
  }, [ensureScopes])

  // Warm the scope catalog up front so "Surprise me" / the picker open instantly.
  useEffect(() => {
    void ensureScopes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dailyTitle = state.board.title.replace(/^Rank /, '')
  const splash = state.board.skins[0]?.splashUrl
  const done = !!state.submitted

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <TierBreadcrumb />
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <FontAwesomeIcon icon={faLayerGroup} className="mr-2 h-3.5" />
          Tier Drop
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          Rank some skins.
        </h1>
        <p className="mt-2 text-sm text-grey1">
          Sort a set S to D, then see how your taste stacks up against the community.
        </p>
      </header>

      {/* Today's set — the hero pick */}
      <motion.button
        ref={dailyRef}
        onClick={() => go(state.board.boardId)}
        onPointerMove={onDailyTilt}
        onPointerLeave={resetDailyTilt}
        disabled={navigating}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={
          reduce
            ? undefined
            : { rotateX: tiltX, rotateY: tiltY, transformPerspective: 800 }
        }
        whileHover={
          reduce
            ? undefined
            : { scale: 1.01, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }
        }
        whileTap={reduce ? undefined : { scale: 0.99, transition: { duration: 0.08 } }}
        className="card-sheen-host group relative mb-3 flex min-h-[8.5rem] w-full items-end overflow-hidden bg-hextech-black/60 p-5 text-left will-change-transform disabled:opacity-60"
      >
        {splash && (
          <img
            src={splash}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25 transition duration-500 group-hover:scale-105 group-hover:opacity-40"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-hextech-black via-hextech-black/75 to-hextech-black/20" />
        <span aria-hidden className="card-sheen" />
        <div className="relative z-10">
          <p
            className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.25em] ${done ? 'text-gold1' : 'text-gold2'}`}
          >
            {done && <FontAwesomeIcon icon={faCircleCheck} className="h-3.5" />}
            {done ? 'Completed' : "Today's set"}
          </p>
          <p className="mt-1 font-serif text-3xl font-bold text-gold1">{dailyTitle}</p>
          <p className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-gold1">
            {done ? 'View your ranking' : 'Rank it'}
            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </p>
        </div>
        {/* Unmistakable "you finished today's" stamp, like the daily puzzles. */}
        {done && (
          <span className="absolute right-4 top-4 z-10 flex items-center gap-1.5 bg-gold5/25 px-2.5 py-1 text-xs font-bold text-gold1 outline outline-gold2/60 -outline-offset-1">
            <FontAwesomeIcon icon={faCircleCheck} className="h-3.5" />
            Ranked
          </span>
        )}
        {/* Border overlay so the splash zoom can't clip it (see DraggableTile). */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 outline outline-2 -outline-offset-2 transition-[outline-color] duration-150 ${
            done
              ? 'outline-gold2/70'
              : 'outline-gold2/50 group-hover:outline-gold1'
          }`}
        />
      </motion.button>

      <div className="grid gap-3 sm:grid-cols-2">
        <motion.button
          onClick={openPicker}
          disabled={navigating}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          whileHover={
            reduce
              ? undefined
              : { scale: 1.02, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }
          }
          whileTap={reduce ? undefined : { scale: 0.98, transition: { duration: 0.08 } }}
          className="flex items-center gap-3 bg-hextech-black/40 p-4 text-left outline outline-icon/20 -outline-offset-1 transition-colors hover:outline-gold2/60 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faLayerGroup} className="h-5 shrink-0 text-gold2" />
          <span>
            <span className="block font-serif text-lg font-bold text-gold1">
              Make your own
            </span>
            <span className="block text-xs text-grey1">
              Any champion, line, year, price, or rarity.
            </span>
          </span>
        </motion.button>
        <motion.button
          onClick={startRandom}
          disabled={navigating || scopesLoading}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          whileHover={
            reduce
              ? undefined
              : { scale: 1.02, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }
          }
          whileTap={reduce ? undefined : { scale: 0.98, transition: { duration: 0.08 } }}
          className="flex items-center gap-3 bg-hextech-black/40 p-4 text-left outline outline-icon/20 -outline-offset-1 transition-colors hover:outline-gold2/60 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faDice} className="h-5 shrink-0 text-gold2" />
          <span>
            <span className="block font-serif text-lg font-bold text-gold1">
              Surprise me
            </span>
            <span className="block text-xs text-grey1">
              Spin for a random set to rank.
            </span>
          </span>
        </motion.button>
      </div>

      {state.stats.community > 0 && (
        <motion.div
          className="mt-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link
            to="/battle/tier-drop/browse"
            className="group inline-flex items-center gap-1.5 text-xs text-grey1/70 transition-colors hover:text-gold1"
          >
            <FontAwesomeIcon icon={faUsers} className="h-3 text-gold2/60" />
            <span>
              <span className="tabular-nums">
                {state.stats.community.toLocaleString()}
              </span>{' '}
              tier lists ranked by the community
            </span>
            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-3 transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </Link>
        </motion.div>
      )}

      <TodayStrip hub={hub} current="tier-list" />

      <BoardPicker
        open={pickerOpen}
        scopes={scopes}
        loading={scopesLoading}
        busy={navigating}
        onPick={(id) => go(id)}
        onClose={() => setPickerOpen(false)}
      />
      <AnimatePresence>
        {casing && (
          <RandomCase
            scopes={casing.scopes}
            target={casing.target}
            onComplete={() => go(casing.target.boardId)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// CS:GO-style "case opening": a reel of random sets scrolls past a center
// reticle, decelerates, and lands on the chosen one before we deal its board.
function RandomCase({
  scopes,
  target,
  onComplete,
}: {
  scopes: TierScopeCatalog
  target: ReelItem
  onComplete: () => void
}) {
  const reduce = useReducedMotion()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [targetX, setTargetX] = useState<number | null>(null)
  const [landed, setLanded] = useState(false)
  const [exiting, setExiting] = useState(false)
  const onDone = useRef(onComplete)
  onDone.current = onComplete

  const CARD_W = 128
  const GAP = 10
  const STRIDE = CARD_W + GAP
  const TARGET_INDEX = 48

  const reel = useMemo(() => {
    const pool = allScopes(scopes)
    return Array.from({ length: 56 }, (_, i) =>
      i === TARGET_INDEX ? target : pool[Math.floor(Math.random() * pool.length)],
    )
  }, [scopes, target])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Kick off the spin (or, under reduced motion, land immediately).
  useEffect(() => {
    if (reduce) {
      setLanded(true)
      return
    }
    const vw = viewportRef.current?.clientWidth ?? 760
    const jitter = (Math.random() - 0.5) * CARD_W * 0.4
    const x = vw / 2 - (TARGET_INDEX * STRIDE + CARD_W / 2) + jitter
    // Hold a beat so the carousel reads as "opening in" before it revs up.
    const t = setTimeout(() => setTargetX(x), 520)
    return () => clearTimeout(t)
  }, [reduce])

  // Once it lands, hold a beat to read the result, then begin the zoom-out.
  useEffect(() => {
    if (!landed || exiting) return
    const t = setTimeout(() => setExiting(true), reduce ? 650 : 800)
    return () => clearTimeout(t)
  }, [landed, exiting, reduce])

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[85] flex flex-col items-center justify-center overflow-hidden bg-hextech-black px-4"
    >
      {/* Content zooms + fades on exit, then hands off to the dealt board. The
          backdrop stays opaque so the menu never flashes behind it. */}
      <motion.div
        className="flex w-full flex-col items-center"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ scale: exiting ? 1.2 : 1, opacity: exiting ? 0 : 1 }}
        transition={
          exiting
            ? { duration: 0.45, ease: 'easeIn' }
            : { type: 'spring', stiffness: 210, damping: 22 }
        }
        onAnimationComplete={() => {
          if (exiting) onDone.current()
        }}
      >
        <motion.p
          key={landed ? 'landed' : 'spinning'}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 px-4 text-center font-serif text-xl font-bold text-gold2"
        >
          {landed ? `Your set: ${target.label}` : 'Choosing your set…'}
        </motion.p>

        <div ref={viewportRef} className="relative w-full max-w-3xl overflow-x-hidden">
          {/* center reticle */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-px -translate-x-1/2 bg-gold1" />
          <div className="pointer-events-none absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-gold1" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 z-20 h-0 w-0 -translate-x-1/2 border-x-8 border-b-8 border-x-transparent border-b-gold1" />
          {/* edge fades */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-hextech-black to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-hextech-black to-transparent" />

          <motion.div
            className="flex py-8"
            style={{ gap: GAP }}
            // One continuous curve: gentle rev-up, fast cruise, long decelerating
            // land. A single bézier keeps velocity continuous, so there's no
            // sudden jump to full speed mid-spin.
            animate={{ x: targetX === null ? 0 : targetX }}
            transition={
              targetX === null
                ? { duration: 0 }
                : { duration: 5, ease: [0.4, 0, 0.12, 1] }
            }
            onAnimationComplete={() => {
              if (targetX !== null && !landed) setLanded(true)
            }}
          >
            {reel.map((item, i) => (
              <div
                key={i}
                style={{ width: CARD_W }}
                className={`flex h-32 shrink-0 flex-col items-center justify-center gap-2 border bg-hextech-black/60 px-2 text-center transition-[transform,box-shadow,opacity] duration-300 ${AXIS_TONE[item.axis]} ${
                  landed && i === TARGET_INDEX
                    ? 'scale-110 shadow-[0_0_28px_rgba(214,170,74,0.55)]'
                    : landed
                      ? 'opacity-40'
                      : ''
                }`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
                  {AXIS_LABEL[item.axis]}
                </span>
                <span className="break-words font-serif text-sm font-bold leading-tight">
                  {item.label}
                </span>
              </div>
            ))}
          </motion.div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

interface Challenge {
  sharerName: string | null
  ranking: SharedRankingRow[]
}

function Builder({
  initialBoard,
  initialSubmitted,
  challenge,
  banner,
  hub,
}: {
  initialBoard: TierBoard
  initialSubmitted?: SubmittedTierList | null
  challenge?: Challenge
  banner?: ReactNode
  hub?: DailyHubState
}) {
  const [board, setBoard] = useState<TierBoard>(initialBoard)
  const [challengeActive, setChallengeActive] = useState(true)
  // Start in results mode when the player already ranked this board.
  const [placed, setPlaced] = useState<Placed>(() =>
    initialSubmitted ? tiersToPlaced(initialSubmitted.tiers) : emptyPlaced(),
  )
  const [zoom, setZoom] = useState<TierListSkin | null>(null)
  const [hoverZone, setHoverZone] = useState<TierName | 'tray' | null>(null)
  const [flash, setFlash] = useState<{ tier: TierName; id: number } | null>(null)
  const [rankedCount, setRankedCount] = useState(0) // lists submitted this session
  const [result, setResult] = useState<TierListResult | null>(
    initialSubmitted?.result ?? null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scopes, setScopes] = useState<TierScopeCatalog | null>(null)
  const [scopesLoading, setScopesLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const recentRef = useRef<string[]>([])
  const flashSeq = useRef(0)
  // Drop-zone elements (the five tiers + the tray), for pointer hit-testing.
  const zonesRef = useRef(new Map<TierName | 'tray', HTMLElement | null>())
  const confettiRef = useRef<ConfettiHandle>(null)

  // A placed tier flashes briefly (and the device buzzes) — drop feedback.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 340)
    return () => clearTimeout(t)
  }, [flash])

  // On submit, lift the page to the top so the results intro from the top.
  useEffect(() => {
    if (result && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [result])

  // Sound preference: load once, then keep the synth + storage in sync.
  useEffect(() => {
    try {
      setMuted(localStorage.getItem('tierlist-muted') === '1')
    } catch {
      /* storage blocked — default to sound on */
    }
  }, [])
  useEffect(() => {
    setSoundEnabled(!muted)
    try {
      localStorage.setItem('tierlist-muted', muted ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [muted])

  const byId = useMemo(
    () => new Map(board.skins.map((s) => [s.skinId, s])),
    [board],
  )
  const placedIds = useMemo(
    () => new Set(TIERS.flatMap((t) => placed[t])),
    [placed],
  )
  const unplaced = board.skins.filter((s) => !placedIds.has(s.skinId))
  const placedCount = placedIds.size
  const tierOf = (skinId: string): TierName | null =>
    TIERS.find((t) => placed[t].includes(skinId)) ?? null

  // Move a skin into a tier (null = back to the tray). Drives both drag-drop
  // and the zoom modal's tier buttons.
  const place = useCallback((skinId: string, tier: TierName | null) => {
    setPlaced((prev) => {
      const next: Placed = {
        S: prev.S.filter((id) => id !== skinId),
        A: prev.A.filter((id) => id !== skinId),
        B: prev.B.filter((id) => id !== skinId),
        C: prev.C.filter((id) => id !== skinId),
        D: prev.D.filter((id) => id !== skinId),
      }
      if (tier) next[tier] = [...next[tier], skinId]
      return next
    })
    if (tier) {
      setFlash({ tier, id: ++flashSeq.current })
      if (typeof navigator !== 'undefined') navigator.vibrate?.(12)
      playPlace(tier)
    } else {
      playPop()
    }
  }, [])

  // Drop-zone geometry in PAGE coords (motion's drag info.point is page-based,
  // i.e. event.pageX/Y, so the scroll offset is baked in here once). Captured at
  // drag start by measureZones — the zones don't move while a tile is in hand
  // (placement happens on drop), so re-reading every zone's rect on every drag
  // frame was pure waste. Measure once, hit-test against the cache.
  const zoneRectsRef = useRef<
    { zone: TierName | 'tray'; left: number; top: number; right: number; bottom: number }[]
  >([])
  const measureZones = useCallback(() => {
    const sx = window.scrollX
    const sy = window.scrollY
    const rects: typeof zoneRectsRef.current = []
    for (const [zone, el] of zonesRef.current) {
      if (!el) continue
      const r = el.getBoundingClientRect()
      rects.push({
        zone,
        left: r.left + sx,
        top: r.top + sy,
        right: r.right + sx,
        bottom: r.bottom + sy,
      })
    }
    zoneRectsRef.current = rects
  }, [])
  // Which drop zone (if any) contains the dragged pointer. Reads the cache that
  // measureZones populated on pickup — no layout reads on the drag hot path.
  const zoneAt = useCallback(
    (point: { x: number; y: number }): TierName | 'tray' | null => {
      for (const r of zoneRectsRef.current) {
        if (
          point.x >= r.left &&
          point.x <= r.right &&
          point.y >= r.top &&
          point.y <= r.bottom
        ) {
          return r.zone
        }
      }
      return null
    },
    [],
  )
  const onTileDrag = useCallback(
    (point: { x: number; y: number }) => setHoverZone(zoneAt(point)),
    [zoneAt],
  )
  const onTileDrop = useCallback(
    (skinId: string, point: { x: number; y: number }) => {
      const zone = zoneAt(point)
      setHoverZone(null)
      if (zone === 'tray') place(skinId, null)
      else if (zone) place(skinId, zone)
      // Dropped in the void → dragSnapToOrigin returns it; no state change.
    },
    [zoneAt, place],
  )

  const reset = useCallback(() => {
    setBoard(initialBoard)
    setPlaced(emptyPlaced())
    setZoom(null)
    setResult(null)
  }, [initialBoard])

  const submit = useCallback(async () => {
    if (placedCount < MIN_PLACED || submitting) return
    setSubmitting(true)
    try {
      const res = await submitTierList({
        data: {
          boardToken: board.token,
          tiers: placed,
          recent: recentRef.current,
          restoreToken: guestRestoreToken(),
        },
      })
      rememberGuestToken(res.guestToken)
      recentRef.current = [...recentRef.current, board.boardId].slice(-12)
      setRankedCount((n) => n + 1)
      playSubmit()
      setResult(res)
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "That tier list didn't save.",
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }, [board, placed, placedCount, submitting])

  const rankAnother = useCallback(() => {
    if (!result) return
    setBoard(result.nextBoard)
    setChallengeActive(false) // the next board is a normal one, not the shared challenge
    setPlaced(emptyPlaced())
    setZoom(null)
    setResult(null)
  }, [result])

  // Open the "make your own" picker, lazy-loading the scope catalog the first time.
  const openPicker = useCallback(async () => {
    setPickerOpen(true)
    if (scopes || scopesLoading) return
    setScopesLoading(true)
    try {
      setScopes(await fetchTierScopes())
    } catch {
      toast("Couldn't load the sets. Try again.", 'error')
    } finally {
      setScopesLoading(false)
    }
  }, [scopes, scopesLoading])

  // Swap the builder onto a player-picked scope (champion/line/year/price/rarity).
  const pickBoard = useCallback(async (boardId: string) => {
    setSwitching(true)
    try {
      const res = await fetchTierList({
        data: { restoreToken: guestRestoreToken(), boardId },
      })
      setBoard(res.board)
      setChallengeActive(false)
      setZoom(null)
      // If they already ranked this set, drop straight into the saved result.
      if (res.submitted) {
        setPlaced(tiersToPlaced(res.submitted.tiers))
        setResult(res.submitted.result)
      } else {
        setPlaced(emptyPlaced())
        setResult(null)
      }
      setPickerOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load that set.", 'error')
    } finally {
      setSwitching(false)
    }
  }, [])

  const resultMap = useMemo(
    () => new Map((result?.rows ?? []).map((r) => [r.skinId, r] as const)),
    [result],
  )
  const locked = result !== null

  return (
    <>
      <div className="container mx-auto max-w-4xl px-4 pt-28 pb-16 md:px-6">
        {banner}
      {!banner && <TierBreadcrumb current={board.title.replace(/^Rank /, '')} />}
      <header className="animate-fade-up mb-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
            <FontAwesomeIcon icon={faLayerGroup} className="mr-2 h-3.5" />
            Tier Drop
          </p>
          <div className="flex items-center gap-3">
            {rankedCount > 0 && (
              <p className="flex items-center gap-1.5 text-sm font-bold text-gold2">
                <FontAwesomeIcon icon={faFire} className="h-3.5" />
                <span className="tabular-nums">
                  <AnimatedNumber value={rankedCount} /> ranked this session
                </span>
              </p>
            )}
            <motion.button
              onClick={() => setMuted((m) => !m)}
              whileTap={{ scale: 0.85 }}
              title={muted ? 'Unmute sounds' : 'Mute sounds'}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
              className="flex h-7 w-7 cursor-pointer items-center justify-center text-grey1 outline outline-icon/20 -outline-offset-1 transition-colors duration-150 hover:text-gold1 hover:outline-gold2/60"
            >
              <FontAwesomeIcon
                icon={muted ? faVolumeXmark : faVolumeHigh}
                className="h-3.5"
              />
            </motion.button>
          </div>
        </div>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {board.title}
        </h1>
        {locked ? (
          <p className="mt-2 text-sm text-grey1">
            How your tiers stack up against the community.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-grey1">{board.subtitle}</p>
            <button
              onClick={openPicker}
              className="group mt-3 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-gold2 transition-colors duration-150 hover:text-gold1"
            >
              <FontAwesomeIcon icon={faLayerGroup} className="h-3.5" />
              Rank a different set
              <FontAwesomeIcon
                icon={faArrowRight}
                className="h-3 transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </button>
          </>
        )}
      </header>

      {result && <VerdictSummary rows={result.rows} />}

      <LayoutGroup>
        {/* Tiers — drop zones for dragged skins. */}
        <div className="flex flex-col gap-2">
          {TIERS.map((t) => (
            <div key={t} className="flex w-full items-stretch gap-2">
              <div className="relative flex w-12 shrink-0">
                <motion.span
                  key={flash?.tier === t ? `f${flash.id}` : 'idle'}
                  initial={false}
                  animate={
                    flash?.tier === t ? { scale: [1, 1.22, 1] } : { scale: 1 }
                  }
                  transition={{ duration: 0.34, ease: 'easeOut' }}
                  className={`flex w-full items-center justify-center font-serif text-2xl font-bold ${TIER_TONE[t]}`}
                >
                  {t}
                </motion.span>
                {/* The top tier wears a crown the moment it has a pick. */}
                {t === 'S' && (
                  <AnimatePresence>
                    {placed.S.length > 0 && (
                      <motion.span
                        key="crown"
                        initial={{ opacity: 0, y: 5, scale: 0.4, rotate: -20 }}
                        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.4 }}
                        transition={{ type: 'spring', stiffness: 460, damping: 17 }}
                        className="pointer-events-none absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 text-gold1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]"
                      >
                        <FontAwesomeIcon icon={faCrown} className="h-3.5" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                )}
              </div>
              <div
                ref={(el) => {
                  zonesRef.current.set(t, el)
                }}
                className={`flex min-h-[5.5rem] md:min-h-[6rem] flex-1 flex-wrap content-center items-center gap-2 p-2 outline -outline-offset-1 transition-colors duration-300 ${
                  locked
                    ? 'bg-hextech-black/40 outline-icon/15'
                    : flash?.tier === t
                      ? 'bg-gold5/30 outline-gold1'
                      : hoverZone === t
                        ? 'bg-gold5/15 outline-gold1'
                        : 'bg-hextech-black/40 outline-icon/15'
                }`}
              >
                {placed[t].map((id) => {
                  const s = byId.get(id)
                  return s ? (
                    <DraggableTile
                      key={id}
                      skin={s}
                      locked={locked}
                      compare={resultMap.get(id)}
                      onZoom={() => setZoom(s)}
                      onPickUp={measureZones}
                      onDrag={onTileDrag}
                      onDrop={(p) => onTileDrop(id, p)}
                    />
                  ) : null
                })}
                {placed[t].length === 0 && (
                  <span className="px-2 text-xs text-grey1/40">
                    {locked ? 'Empty' : 'drop here'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Tray of unplaced skins (also a drop zone, to send one back). */}
        {!locked && (
          <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold2/80">
              Not yet placed
            </p>
            <p className="text-xs text-grey1 tabular-nums">
              <AnimatedNumber value={placedCount} /> of {board.skins.length} placed
            </p>
          </div>
          <div
            ref={(el) => {
              zonesRef.current.set('tray', el)
            }}
            className={`flex min-h-[5.5rem] md:min-h-[6rem] flex-wrap content-start gap-2 p-2 outline -outline-offset-1 transition-colors duration-150 ${
              hoverZone === 'tray'
                ? 'bg-gold5/10 outline-gold1'
                : 'bg-hextech-black/30 outline-icon/15'
            }`}
          >
            {unplaced.map((s) => (
              <DraggableTile
                key={s.skinId}
                skin={s}
                onZoom={() => setZoom(s)}
                onPickUp={measureZones}
                onDrag={onTileDrag}
                onDrop={(p) => onTileDrop(s.skinId, p)}
              />
            ))}
            {unplaced.length === 0 && (
              <span className="px-2 py-4 text-xs text-grey1/50">
                All placed. Submit when you're happy.
              </span>
            )}
          </div>
          </section>
        )}
      </LayoutGroup>

      {result ? (
        <>
          {challengeActive && challenge && (
            <section className="mt-10">
              <h2 className="mb-3 text-center font-serif text-lg font-bold text-gold2">
                How {challenge.sharerName ?? 'they'} ranked it
              </h2>
              <TierShowcase ranking={challenge.ranking} />
            </section>
          )}

          <SharePanel
            rows={result.rows}
            boardId={result.boardId}
            username={result.username}
          />

          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <motion.button
                onClick={rankAnother}
                whileTap={{ scale: 0.97 }}
                className="flex cursor-pointer items-center gap-2 bg-gold5/20 px-6 py-3 font-serif text-lg font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 transition duration-150 hover:bg-gold5/30 hover:outline-gold1"
              >
                <FontAwesomeIcon icon={faRotate} className="h-4" />
                Rank another
              </motion.button>
              <motion.button
                onClick={openPicker}
                whileTap={{ scale: 0.97 }}
                className="flex cursor-pointer items-center gap-2 bg-hextech-black/50 px-5 py-3 font-serif text-lg font-bold text-gold2 outline outline-icon/25 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2/60"
              >
                <FontAwesomeIcon icon={faLayerGroup} className="h-4" />
                Pick a set
              </motion.button>
            </div>
            <Link
              to="/rankings"
              className="text-sm text-grey1 underline-offset-2 transition duration-150 hover:text-gold1 hover:underline"
            >
              See the full rankings your verdicts build →
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 text-center text-xs text-grey1/70">
            Drag a skin into a tier, or tap it to zoom in and place it. Pile as
            many into a tier as you like.
          </p>

          {/* Submit */}
          <div className="mt-6 flex justify-center">
            <motion.button
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                confettiRef.current?.fire(r.left + r.width / 2, r.top + r.height / 2)
                submit()
              }}
              disabled={placedCount < MIN_PLACED || submitting}
              animate={
                placedCount >= MIN_PLACED && !submitting
                  ? {
                      boxShadow: [
                        '0 0 0px rgba(214,170,74,0)',
                        '0 0 22px rgba(214,170,74,0.45)',
                        '0 0 0px rgba(214,170,74,0)',
                      ],
                    }
                  : { boxShadow: '0 0 0px rgba(214,170,74,0)' }
              }
              transition={
                placedCount >= MIN_PLACED && !submitting
                  ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.2 }
              }
              whileTap={{ scale: 0.97 }}
              className="flex cursor-pointer items-center gap-2 bg-gold5/20 px-6 py-3 font-serif text-lg font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 transition-colors duration-150 hover:bg-gold5/30 hover:outline-gold1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FontAwesomeIcon icon={faCheck} className="h-4" />
              {submitting
                ? 'Saving…'
                : placedCount < MIN_PLACED
                  ? `Place ${MIN_PLACED - placedCount} more to submit`
                  : 'Submit tier list'}
            </motion.button>
          </div>
        </>
      )}

      <AnimatePresence>
        {zoom && (
          <SkinZoom
            skin={zoom}
            currentTier={tierOf(zoom.skinId)}
            compare={resultMap.get(zoom.skinId)}
            onPlace={(tier) => {
              place(zoom.skinId, tier)
              setZoom(null)
            }}
            onClose={() => setZoom(null)}
          />
        )}
      </AnimatePresence>
      {hub && <TodayStrip hub={hub} current="tier-list" />}
      </div>
      <BoardPicker
        open={pickerOpen}
        scopes={scopes}
        loading={scopesLoading}
        busy={switching}
        onPick={pickBoard}
        onClose={() => setPickerOpen(false)}
      />
      <ConfettiCannon ref={confettiRef} />
    </>
  )
}

// Click-a-skin zoom: the big splash + quick tier-placement buttons (also the
// keyboard-accessible way to place, since drag isn't). Portaled to <body> so the
// navbar's backdrop-blur can't clip it.
function SkinZoom({
  skin,
  currentTier,
  onPlace,
  onClose,
  compare,
}: {
  skin: TierListSkin
  currentTier: TierName | null
  onPlace: (tier: TierName | null) => void
  onClose: () => void
  compare?: TierResultRow
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-5 bg-hextech-black/92 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        title="Close (Esc)"
        className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center bg-hextech-black/60 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-icon"
      >
        <FontAwesomeIcon icon={faXmark} className="h-5" />
      </button>

      <motion.img
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        src={skin.splashUrl}
        alt={`${skin.name} splash art`}
        className="max-h-[60vh] max-w-full object-contain shadow-2xl outline outline-gold5/60 -outline-offset-1"
      />

      <div className="text-center">
        <p className="font-serif text-2xl font-bold text-gold1">{skin.name}</p>
        <p className="text-sm text-grey1">{skin.championName}</p>
      </div>

      {compare ? (
        // Results mode: how you ranked it vs the community, no placing.
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <TierBadge tier={compare.yourTier} label="you" />
            <FontAwesomeIcon icon={faArrowRight} className="h-3.5 text-grey1/40" />
            <TierBadge tier={compare.communityTier} label="community" />
          </div>
          {compare.agreementPct !== null && (
            <p className="text-sm text-grey1">
              <FontAwesomeIcon icon={faUsers} className="mr-1.5 h-3 text-gold2/70" />
              {compare.agreementPct}% of players placed it in {compare.yourTier}
            </p>
          )}
          {compare.hotTake && (
            <span className="flex items-center gap-1 bg-blue5/30 px-2 py-0.5 text-[11px] font-bold text-blue1 outline outline-blue3/50 -outline-offset-1">
              <FontAwesomeIcon icon={faBolt} className="h-3" />
              Hot take
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="mr-1 text-xs uppercase tracking-wide text-grey1">
            Place in
          </span>
          {TIERS.map((t) => (
            <button
              key={t}
              onClick={() => onPlace(t)}
              aria-label={`Place in tier ${t}`}
              className={`flex h-11 w-11 cursor-pointer items-center justify-center font-serif text-lg font-bold outline -outline-offset-1 transition duration-150 hover:scale-110 ${TIER_TONE[t]} ${
                currentTier === t ? 'outline-2 outline-gold1' : 'outline-transparent'
              }`}
            >
              {t}
            </button>
          ))}
          {currentTier && (
            <button
              onClick={() => onPlace(null)}
              className="flex h-11 cursor-pointer items-center gap-1.5 bg-hextech-black/60 px-3 text-sm font-bold text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2"
            >
              <FontAwesomeIcon icon={faRotate} className="h-3.5" />
              Tray
            </button>
          )}
        </div>
      )}
    </motion.div>,
    document.body,
  )
}

// ─── make your own ───────────────────────────────────────────────────────────

const PICKER_TABS = [
  { key: 'champions', label: 'Champion' },
  { key: 'lines', label: 'Skin line' },
  { key: 'years', label: 'Year' },
  { key: 'prices', label: 'Price' },
  { key: 'rarities', label: 'Rarity' },
] as const
type PickerTab = (typeof PICKER_TABS)[number]['key']

// "Make your own": pick a scope (champion / skin line / year / price / rarity)
// to rank, instead of the served board. Portaled to <body> so the navbar's
// backdrop-blur can't clip it; bottom-sheet on mobile, centered card on desktop.
function BoardPicker({
  open,
  scopes,
  loading,
  busy,
  onPick,
  onClose,
}: {
  open: boolean
  scopes: TierScopeCatalog | null
  loading: boolean
  busy: boolean
  onPick: (boardId: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<PickerTab>('champions')
  const [q, setQ] = useState('')
  // This portal renders into document.body, which doesn't exist during SSR.
  // BoardPicker is always mounted (it's a controlled overlay), so an unguarded
  // createPortal here evaluated `document.body` on the server and threw —
  // aborting the route's streaming-SSR boundary (React #419), after which the
  // client silently re-rendered. Gate on a client mount flag: render nothing
  // until mounted, matching the server's null on first paint (no hydration
  // mismatch). The picker starts closed, so the null first frame is invisible.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const options = scopes?.[tab] ?? []
  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options
  const searchable = tab === 'champions' || tab === 'lines'

  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-hextech-black/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            className="relative flex h-[85vh] max-h-[85vh] w-full max-w-lg flex-col bg-hextech-black outline outline-gold2/40 -outline-offset-1 sm:h-[38rem]"
            initial={{ opacity: 0, scale: 0.96, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 28 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            <header className="flex items-center justify-between gap-3 border-b border-icon/15 p-4">
              <div>
                <h2 className="font-serif text-lg font-bold text-gold1">
                  Pick a set to rank
                </h2>
                <p className="text-xs text-grey1">
                  Any champion, line, year, price, or rarity.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center text-grey1 transition-colors hover:text-gold1"
              >
                <FontAwesomeIcon icon={faXmark} className="h-4" />
              </button>
            </header>

            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {PICKER_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key)
                    setQ('')
                  }}
                  className={`relative cursor-pointer px-3 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                    tab === t.key ? 'text-gold1' : 'text-grey1 hover:text-gold2'
                  }`}
                >
                  {tab === t.key && (
                    <motion.span
                      layoutId="picker-tab"
                      className="absolute inset-0 bg-gold5/25 outline outline-gold2/60 -outline-offset-1"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{t.label}</span>
                </button>
              ))}
            </div>

            {searchable && (
              <motion.div
                className="px-4 pt-3"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <div className="relative">
                  <FontAwesomeIcon
                    icon={faMagnifyingGlass}
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 -translate-y-1/2 text-grey1/60"
                  />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${tab === 'champions' ? 'champions' : 'lines'}…`}
                    className="w-full bg-hextech-black/60 py-2 pl-9 pr-3 text-sm text-gold1 outline outline-icon/30 -outline-offset-1 placeholder:text-grey1/50 focus:outline-gold2"
                  />
                </div>
              </motion.div>
            )}

            {/* Fixed-height scroll area so the modal never resizes between tabs. */}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
              {loading || !scopes ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-grey1">Loading sets…</p>
                </div>
              ) : (
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {filtered.length === 0 ? (
                    <p className="py-12 text-center text-sm text-grey1">
                      {needle ? `Nothing matches “${q.trim()}”.` : 'No sets here yet.'}
                    </p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {filtered.map((o) => (
                        <li key={o.boardId}>
                          <button
                            disabled={busy}
                            onClick={() => onPick(o.boardId)}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 bg-hextech-black/40 px-3 py-2 text-left text-sm text-gold1 outline outline-icon/15 -outline-offset-1 transition-colors duration-150 hover:bg-gold5/15 hover:outline-gold2/60 disabled:cursor-wait disabled:opacity-50"
                          >
                            <span className="truncate font-semibold">{o.label}</span>
                            <span className="shrink-0 text-xs tabular-nums text-grey1/70">
                              {o.count}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </div>

            {busy && (
              <div className="border-t border-icon/15 py-2 text-center text-xs font-semibold text-gold2">
                Dealing your board…
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ─── compare ───────────────────────────────────────────────────────────────

// ─── confetti cannon ─────────────────────────────────────────────────────────

// Physics confetti that erupts from a screen point (the Submit button). The
// particle model is adapted from canvas-confetti (Kiril Vatev, ISC); keyframes
// are pre-computed so every piece animates entirely on the GPU. Rendered in a
// fixed portal so the burst survives the builder→verdict page transition.

interface ConfettiParticle {
  keyframes: DOMKeyframesDefinition
  duration: number
  size: number
  color: string
  shape: 'circle' | 'rect' | 'strip'
}
interface ConfettiBurst {
  id: number
  x: number
  y: number
  particles: ConfettiParticle[]
}
export interface ConfettiHandle {
  fire: (x: number, y: number) => void
}

const CONFETTI_COLORS = ['#c8423a', '#d98a2b', '#3fa05a', '#3a78c8', '#e8c14a', '#d6aa4a', '#f4f0e6']
const CONFETTI_SHAPES: ConfettiParticle['shape'][] = ['circle', 'rect', 'rect', 'strip', 'strip']
const KEYFRAME_STEPS = 40
const SCALE_FRACTION = 0.08

function confettiKeyframes(p: {
  angle: number
  startVelocity: number
  decay: number
  gravity: number
  drift: number
  wobbleSpeed: number
  wobbleOffset: number
  size: number
  ticks: number
  tiltRotations: number
  rotation: number
}): DOMKeyframesDefinition {
  const transform: string[] = []
  const opacity: number[] = []
  let velocity = p.startVelocity
  let x = 0
  let y = 0
  let wobble = p.wobbleOffset
  let tick = 0
  for (let step = 0; step <= KEYFRAME_STEPS; step++) {
    const t = step / KEYFRAME_STEPS
    if (step > 0) {
      const target = Math.round((step * p.ticks) / KEYFRAME_STEPS)
      while (tick < target) {
        x += Math.cos(p.angle) * velocity + p.drift
        y += Math.sin(p.angle) * velocity + p.gravity * 3
        velocity *= p.decay
        wobble += p.wobbleSpeed
        tick++
      }
    }
    const wx = step === 0 ? 0 : x + Math.cos(wobble) * 15 * p.size
    let scale: number
    if (t < SCALE_FRACTION * 0.6) scale = (t / (SCALE_FRACTION * 0.6)) * 1.15
    else if (t < SCALE_FRACTION)
      scale = 1.15 - ((t - SCALE_FRACTION * 0.6) / (SCALE_FRACTION * 0.4)) * 0.15
    else scale = 1
    const rotateY = p.tiltRotations * 360 * t
    let op: number
    if (t <= 0.5) op = 1
    else if (t <= 0.8) op = 1 - ((t - 0.5) / 0.3) * 0.5
    else op = 0.5 - ((t - 0.8) / 0.2) * 0.5
    transform.push(
      `translate(${wx}px, ${y}px) scale(${scale}) rotateY(${rotateY}deg) rotate(${p.rotation}deg)`,
    )
    opacity.push(op)
  }
  return { transform, opacity }
}

function ConfettiPiece({ particle }: { particle: ConfettiParticle }) {
  const ref = useRef<HTMLDivElement>(null)
  const { keyframes, duration, size, color, shape } = particle
  const width = shape === 'strip' ? size * 0.3 : shape === 'rect' ? size * 0.7 : size
  const height = shape === 'strip' ? size * 2 : size
  const borderRadius = shape === 'circle' ? '50%' : shape === 'strip' ? size * 0.12 : 2
  useEffect(() => {
    if (!ref.current) return
    const a = animate(ref.current, keyframes, { duration, ease: 'linear' })
    return () => a.cancel()
  }, [keyframes, duration])
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        width,
        height,
        borderRadius,
        backgroundColor: color,
        willChange: 'transform, opacity',
        pointerEvents: 'none',
      }}
    />
  )
}

const ConfettiCannon = forwardRef<ConfettiHandle>(function ConfettiCannon(_props, ref) {
  const reduce = useReducedMotion()
  const [bursts, setBursts] = useState<ConfettiBurst[]>([])
  const nextId = useRef(0)

  useImperativeHandle(
    ref,
    () => ({
      fire: (x, y) => {
        if (reduce) return
        const id = nextId.current++
        const particleCount = 80
        const startVelocity = 34
        const spread = 130
        const decay = 0.9
        const gravity = 1.1
        const duration = 2.4
        const size = 1.1
        const ticks = Math.round(duration * 60)
        const rad = spread * (Math.PI / 180)
        const particles: ConfettiParticle[] = Array.from({ length: particleCount }, () => {
          const angle = -Math.PI / 2 + (0.5 * rad - Math.random() * rad)
          const velocity = startVelocity * 0.5 + Math.random() * startVelocity
          return {
            keyframes: confettiKeyframes({
              angle,
              startVelocity: velocity,
              decay,
              gravity,
              drift: 0,
              wobbleSpeed: Math.min(0.11, Math.random() * 0.1 + 0.05),
              wobbleOffset: Math.random() * 10,
              size,
              ticks,
              tiltRotations: 2 + Math.random() * 4,
              rotation: Math.random() * 360,
            }),
            duration,
            size: 7 * size + Math.random() * 6 * size,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            shape: CONFETTI_SHAPES[Math.floor(Math.random() * CONFETTI_SHAPES.length)],
          }
        })
        setBursts((prev) => [...prev, { id, x, y, particles }])
        setTimeout(
          () => setBursts((prev) => prev.filter((b) => b.id !== id)),
          (duration + 0.5) * 1000,
        )
      },
    }),
    [reduce],
  )

  if (bursts.length === 0) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[95] overflow-hidden" aria-hidden>
      {bursts.map((b) => (
        <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y }}>
          {b.particles.map((p, i) => (
            <ConfettiPiece key={i} particle={p} />
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
})

// The post-submit summary card, shown atop the player's now-locked tier list:
// how many tiers matched the community, a taste read, and the boldest call.
function VerdictSummary({ rows }: { rows: TierResultRow[] }) {
  const total = rows.length
  const matched = rows.filter((r) => r.yourTier === r.communityTier).length
  const boldest = rows.reduce<{ d: number; row: TierResultRow | null }>(
    (best, r) => {
      const d = Math.abs(
        TIERS.indexOf(r.yourTier) - TIERS.indexOf(r.communityTier),
      )
      return d > best.d ? { d, row: r } : best
    },
    { d: 0, row: null },
  )
  const taste =
    matched === total
      ? 'Dead-on with the crowd'
      : matched >= total * 0.6
        ? 'Mostly aligned with the community'
        : 'A contrarian after my own heart'

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="mb-6 bg-hextech-black/40 p-4 text-center outline outline-gold5/40 -outline-offset-1"
    >
        <p className="font-serif text-xl font-bold text-gold1">
          You agree with the community on{' '}
          <span className="tabular-nums text-gold2">
            <AnimatedNumber value={matched} />
          </span>{' '}
          of {total}
        </p>
        <p className="mt-1 text-sm text-gold2">{taste}</p>
        {boldest.row && boldest.d >= 2 && (
          <p className="mt-2 text-sm text-grey1">
            <FontAwesomeIcon icon={faFire} className="mr-1.5 h-3 text-gold2" />
            Boldest call:{' '}
            <span className="font-bold text-gold1">{boldest.row.name}</span>. You
            said {boldest.row.yourTier}, they rank it {boldest.row.communityTier}.
          </p>
        )}
      </motion.div>
  )
}

// ─── shared-link views ───────────────────────────────────────────────────────

// Read-only render of someone's tiers (used by the reveal screen and the
// post-submit "how they ranked it" on a challenge).
function TierShowcase({ ranking }: { ranking: SharedRankingRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {TIERS.map((t) => {
        const skins = ranking.filter((r) => r.tier === t)
        return (
          <div key={t} className="flex items-stretch gap-2">
            <span
              className={`flex w-12 shrink-0 items-center justify-center font-serif text-2xl font-bold ${TIER_TONE[t]}`}
            >
              {t}
            </span>
            <div className="flex min-h-[3.75rem] flex-1 flex-wrap content-center items-center gap-2 bg-hextech-black/40 p-2 outline outline-icon/15 -outline-offset-1">
              {skins.map((r) => (
                <button
                  key={r.skinId}
                  onClick={() =>
                    openLightbox({
                      url: r.splashUrl,
                      title: r.name,
                      subtitle: r.championName,
                    })
                  }
                  title={`${r.name}: click to zoom`}
                  className="aspect-square w-14 shrink-0 cursor-zoom-in overflow-hidden outline outline-icon/25 -outline-offset-1 transition duration-150 hover:outline-gold2 md:w-16"
                >
                  <img
                    src={r.splashUrl}
                    alt={r.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
              {skins.length === 0 && (
                <span className="px-2 text-xs text-grey1/40">Empty</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RevealView({
  name,
  ranking,
  onStart,
}: {
  name: string | null
  ranking: SharedRankingRow[]
  onStart: () => void
}) {
  return (
    <div className="container mx-auto max-w-3xl px-4 pt-28 pb-16 md:px-6">
      <header className="animate-fade-up mb-6 text-center">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <FontAwesomeIcon icon={faShareNodes} className="mr-2 h-3.5" />
          Shared tier list
        </p>
        <h1 className="font-serif text-3xl font-bold text-gold1 md:text-4xl">
          {name ? `${name}'s tier list` : 'A shared tier list'}
        </h1>
        <p className="mt-2 text-sm text-grey1">
          {ranking[0]?.championName
            ? `${ranking[0].championName}: see how they ranked it, then make your own.`
            : 'See how they ranked it, then make your own.'}
        </p>
      </header>

      <TierShowcase ranking={ranking} />

      <div className="mt-8 flex justify-center">
        <button
          onClick={onStart}
          className="flex cursor-pointer items-center gap-2 bg-gold5/20 px-6 py-3 font-serif text-lg font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 transition duration-150 hover:bg-gold5/30 hover:outline-gold1"
        >
          <FontAwesomeIcon icon={faLayerGroup} className="h-4" />
          Rank it yourself
        </button>
      </div>
    </div>
  )
}

function ShareNotice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-2 bg-gold5/10 px-4 py-3 text-sm text-gold1 outline outline-gold2/40 -outline-offset-1">
      <FontAwesomeIcon icon={faShareNodes} className="h-3.5 shrink-0 text-gold2" />
      <span>{children}</span>
    </div>
  )
}

function SharedTierList({ shared }: { shared: SharedTierListState }) {
  // Reveal opens on the sharer's ranking; everything else goes straight to the
  // builder for the shared set.
  const [started, setStarted] = useState(
    !(shared.found && shared.reveal && shared.ranking),
  )
  if (shared.found && shared.reveal && shared.ranking && !started) {
    return (
      <RevealView
        name={shared.sharerName}
        ranking={shared.ranking}
        onStart={() => setStarted(true)}
      />
    )
  }
  const banner = !shared.found ? (
    <ShareNotice>That shared list has expired. Here's a fresh board to rank.</ShareNotice>
  ) : shared.mode === 'hide' ? (
    <ShareNotice>
      {shared.sharerName ?? 'Someone'} challenged you. Rank these, then see their take.
    </ShareNotice>
  ) : null
  const challenge =
    shared.found && shared.mode === 'hide' && shared.ranking
      ? { sharerName: shared.sharerName, ranking: shared.ranking }
      : undefined
  return <Builder initialBoard={shared.board} challenge={challenge} banner={banner} />
}

const ACTION_BTN =
  'flex cursor-pointer items-center gap-2 bg-hextech-black/60 px-4 py-2 text-sm font-bold text-grey1 no-underline outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-gold2 disabled:cursor-not-allowed disabled:opacity-50'

function Choice({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean
  onClick: () => void
  title: string
  desc: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 text-left outline -outline-offset-1 transition duration-150 ${
        active
          ? 'bg-gold5/25 outline-gold1'
          : 'bg-hextech-black/40 outline-icon/20 hover:outline-icon/50'
      }`}
      aria-pressed={active}
    >
      {/* Radio dot — filled + checked when selected, empty ring when not. */}
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
          active
            ? 'bg-gold1 text-hextech-black'
            : 'text-transparent outline outline-icon/40 -outline-offset-1'
        }`}
      >
        <FontAwesomeIcon icon={faCheck} />
      </span>
      <span className="flex flex-col">
        <span className={`font-bold ${active ? 'text-gold1' : 'text-grey1'}`}>{title}</span>
        <span className="text-xs text-grey1/70">{desc}</span>
      </span>
    </button>
  )
}

// The customizable share, per the spec: choose what to share (your ranking or
// just the board), whether your answers show before or after they rank it, and
// copy/download an image of your tiers with your name + watermark.
function SharePanel({
  rows,
  boardId,
  username,
}: {
  rows: TierResultRow[]
  boardId: string
  username: string | null
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(username ?? '')
  const [boardOnly, setBoardOnly] = useState(false)
  const [revealAfter, setRevealAfter] = useState(false)

  const tiers = useMemo(() => {
    const t: Partial<Record<TierName, string[]>> = {}
    for (const r of rows) (t[r.yourTier] ??= []).push(r.skinId)
    return t
  }, [rows])

  const [busy, setBusy] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const trimmed = name.trim() || undefined
  const mode: ShareMode = boardOnly ? 'board' : revealAfter ? 'hide' : 'reveal'

  // Mint shares on demand, memoized by option signature, so each distinct set of
  // options creates at most one row. The link and the image are separate shares
  // (the image always carries your full ranking; the link may be board-only).
  const linkCache = useRef<{ sig: string; id: string } | null>(null)
  const imageCache = useRef<{ sig: string; id: string } | null>(null)
  const mint = useCallback(
    async (cache: { current: { sig: string; id: string } | null }, input: ShareInput) => {
      const sig = JSON.stringify(input)
      if (cache.current?.sig === sig) return cache.current.id
      const { id } = await createTierShare({ data: input })
      cache.current = { sig, id }
      return id
    },
    [],
  )
  const linkInput: ShareInput = { boardId, tiers: boardOnly ? null : tiers, name: trimmed, mode }
  const imageInput: ShareInput = { boardId, tiers, name: trimmed, mode: 'reveal' }

  const canShare = typeof navigator !== 'undefined' && !!navigator.share
  const run = (fn: () => Promise<void>) => async () => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const shareLink = run(async () => {
    const id = await mint(linkCache, linkInput)
    const url = `${origin}/battle/tier-drop?s=${id}`
    try {
      if (canShare) await navigator.share({ title: 'My tier list', url })
      else {
        await navigator.clipboard.writeText(url)
        toast('Link copied to clipboard', 'success')
      }
    } catch {
      /* share sheet cancelled */
    }
  })
  const downloadImage = run(async () => {
    const id = await mint(imageCache, imageInput)
    const a = document.createElement('a')
    a.href = `${origin}/og/tierlist/${id}`
    a.download = 'tier-list.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
  const copyImage = run(async () => {
    try {
      const id = await mint(imageCache, imageInput)
      const blob = await (await fetch(`${origin}/og/tierlist/${id}`)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      toast('Image copied to clipboard', 'success')
    } catch {
      toast("Couldn't copy the image. Use Download instead.", 'error')
    }
  })

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!open ? (
        <motion.div
          key="share-cta"
          className="mt-8 flex justify-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
          transition={{ duration: 0.25 }}
        >
          <motion.button
            onClick={() => setOpen(true)}
            whileTap={{ scale: 0.97 }}
            className="flex cursor-pointer items-center gap-2 bg-gold5/20 px-6 py-3 font-serif text-lg font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 transition duration-150 hover:bg-gold5/30 hover:outline-gold1"
          >
            <FontAwesomeIcon icon={faShareNodes} className="h-4" />
            Share this
          </motion.button>
        </motion.div>
      ) : (
        <motion.section
          key="share-panel"
          className="mt-8 overflow-hidden bg-hextech-black/40 p-4 outline outline-icon/15 -outline-offset-1"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.18 } }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="mb-3 font-serif text-lg font-bold text-gold2">
        <FontAwesomeIcon icon={faShareNodes} className="mr-2 h-4" />
        Share your tier list
      </h2>

      <label className="mb-4 block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-grey1">
          Name on the card
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          className="w-full max-w-xs bg-hextech-black/60 px-3 py-2 text-sm text-gold1 outline outline-icon/30 -outline-offset-1 focus:outline-gold2"
        />
      </label>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <Choice
          active={!boardOnly}
          onClick={() => setBoardOnly(false)}
          title="My ranking"
          desc="Share your tiers."
        />
        <Choice
          active={boardOnly}
          onClick={() => setBoardOnly(true)}
          title="Just the board"
          desc="Send the blank set, let them rank it."
        />
      </div>

      <AnimatePresence initial={false}>
        {!boardOnly && (
          <motion.div
            key="reveal-choice"
            className="grid gap-2 overflow-hidden sm:grid-cols-2"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            <Choice
              active={!revealAfter}
              onClick={() => setRevealAfter(false)}
              title="Show answers right away"
              desc="They see your tiers on open."
            />
            <Choice
              active={revealAfter}
              onClick={() => setRevealAfter(true)}
              title="Hide until they rank it"
              desc="They rank it first, then compare."
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap gap-2">
        <button onClick={shareLink} disabled={busy} className={ACTION_BTN}>
          <FontAwesomeIcon icon={faLink} className="h-3.5 text-gold2" />
          {canShare ? 'Share link' : 'Copy link'}
        </button>
        <button onClick={downloadImage} disabled={busy} className={ACTION_BTN}>
          <FontAwesomeIcon icon={faDownload} className="h-3.5 text-gold2" />
          Download image
        </button>
        <button onClick={copyImage} disabled={busy} className={ACTION_BTN}>
          <FontAwesomeIcon icon={faImage} className="h-3.5 text-gold2" />
          Copy image
        </button>
      </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}

function TierBadge({ tier, label }: { tier: TierName; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={`flex h-8 w-8 items-center justify-center font-serif text-base font-bold ${TIER_TONE[tier]}`}
      >
        {tier}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-grey1/60">
        {label}
      </span>
    </div>
  )
}
