import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faBolt,
  faCheck,
  faLayerGroup,
  faRotate,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import { ogMeta } from '~/lib/games/ogMeta'
import { fetchTierList, submitTierList } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import type {
  TierBoard,
  TierListResult,
  TierName,
  TierResultRow,
} from '~/lib/games/types'

export const Route = createFileRoute('/battle/tiers')({
  loader: async () => {
    const restoreToken = guestRestoreToken()
    return { state: await fetchTierList({ data: { restoreToken } }) }
  },
  head: () => ({
    meta: [
      { title: 'Tier List · Skin Battle' },
      {
        name: 'description',
        content:
          "Sort a champion's skins into tiers. One tier list is worth dozens of head-to-head verdicts — and builds the community ranking.",
      },
      ...ogMeta({
        title: 'Tier List · Skin Battle',
        description:
          "Sort a champion's skins S to D, then see how your take stacks up against the community.",
        card: 'tier-list',
        path: '/battle/tiers',
      }),
    ],
  }),
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

// ─── builder ─────────────────────────────────────────────────────────────────

function SkinTile({
  name,
  championName,
  splashUrl,
  selected,
  onSelect,
}: {
  name: string
  championName: string
  splashUrl: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={(e) => {
        // Stop the parent row/tray's place handler from also firing.
        e.stopPropagation()
        onSelect()
      }}
      className={`group relative aspect-square w-[4.5rem] shrink-0 cursor-pointer overflow-hidden bg-hextech-black/60 outline -outline-offset-2 transition duration-150 md:w-20 ${
        selected
          ? 'outline-2 outline-gold1'
          : 'outline-icon/25 hover:outline-gold2'
      }`}
      title={`${name} — ${championName}`}
      aria-pressed={selected}
    >
      <img
        src={splashUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-hextech-black/95 to-transparent px-1 pb-0.5 pt-3 text-[10px] font-bold leading-tight text-gold1">
        {name}
      </span>
    </button>
  )
}

function TierListPage() {
  const { state } = Route.useLoaderData()
  const [board, setBoard] = useState<TierBoard>(state.board)
  const [placed, setPlaced] = useState<Placed>(emptyPlaced)
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<TierListResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const recentRef = useRef<string[]>([])

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

  // Tap-to-place: tap a skin to select it, then tap a tier (or the tray) to
  // drop it there. Works identically on desktop and touch.
  const place = useCallback(
    (tier: TierName | null) => {
      if (!selected) return
      setPlaced((prev) => {
        const next: Placed = {
          S: prev.S.filter((id) => id !== selected),
          A: prev.A.filter((id) => id !== selected),
          B: prev.B.filter((id) => id !== selected),
          C: prev.C.filter((id) => id !== selected),
          D: prev.D.filter((id) => id !== selected),
        }
        if (tier) next[tier] = [...next[tier], selected]
        return next
      })
      setSelected(null)
    },
    [selected],
  )

  const reset = useCallback(() => {
    setBoard(state.board)
    setPlaced(emptyPlaced())
    setSelected(null)
    setResult(null)
  }, [state.board])

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
      setResult(res)
      setSelected(null)
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
    setPlaced(emptyPlaced())
    setSelected(null)
    setResult(null)
  }, [result])

  if (result) {
    return (
      <CompareView
        rows={result.rows}
        onAnother={rankAnother}
        boardTitle={board.title}
      />
    )
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 pt-28 pb-16 md:px-6">
      <header className="animate-fade-up mb-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          <FontAwesomeIcon icon={faLayerGroup} className="mr-2 h-3.5" />
          Tier List
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          {board.title}
        </h1>
        <p className="mt-2 text-sm text-grey1">{board.subtitle}</p>
      </header>

      {/* Tiers */}
      <div className="flex flex-col gap-2">
        {TIERS.map((t) => (
          <div
            key={t}
            role="button"
            tabIndex={selected ? 0 : -1}
            aria-label={`Place selected skin in tier ${t}`}
            onClick={() => place(t)}
            onKeyDown={(e) => {
              if (selected && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                place(t)
              }
            }}
            className={`group flex w-full items-stretch gap-2 ${
              selected ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <span
              className={`flex w-12 shrink-0 items-center justify-center font-serif text-2xl font-bold ${TIER_TONE[t]}`}
            >
              {t}
            </span>
            <span
              className={`flex min-h-[5.25rem] flex-1 flex-wrap content-center items-center gap-2 bg-hextech-black/40 p-2 outline -outline-offset-1 transition duration-150 ${
                selected
                  ? 'outline-gold2/70 group-hover:bg-gold5/10'
                  : 'outline-icon/15'
              }`}
            >
              {placed[t].map((id) => {
                const s = byId.get(id)!
                return (
                  <SkinTile
                    key={id}
                    {...s}
                    selected={selected === id}
                    onSelect={() => setSelected((cur) => (cur === id ? null : id))}
                  />
                )
              })}
              {placed[t].length === 0 && (
                <span className="px-2 text-xs text-grey1/50">
                  {selected ? 'Tap to drop here' : 'empty'}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Tray of unplaced skins */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold2/80">
            Not yet placed
          </p>
          <p className="text-xs text-grey1">
            {placedCount} of {board.skins.length} placed
          </p>
        </div>
        <div
          onClick={() => place(null)}
          className={`flex flex-wrap gap-2 bg-hextech-black/30 p-2 outline -outline-offset-1 ${
            selected ? 'outline-gold2/50' : 'outline-icon/15'
          }`}
        >
          {unplaced.map((s) => (
            <SkinTile
              key={s.skinId}
              {...s}
              selected={selected === s.skinId}
              onSelect={() =>
                setSelected((cur) => (cur === s.skinId ? null : s.skinId))
              }
            />
          ))}
          {unplaced.length === 0 && (
            <span className="px-2 py-4 text-xs text-grey1/50">
              All placed — submit when you're happy.
            </span>
          )}
        </div>
      </section>

      <p className="mt-4 text-center text-xs text-grey1/70">
        {selected
          ? 'Now tap a tier to drop it — or tap the tray to send it back.'
          : 'Tap a skin, then tap a tier. Pile as many into a tier as you like.'}
      </p>

      {/* Submit */}
      <div className="mt-6 flex justify-center">
        <button
          onClick={submit}
          disabled={placedCount < MIN_PLACED || submitting}
          className="flex cursor-pointer items-center gap-2 bg-gold5/20 px-6 py-3 font-serif text-lg font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 transition duration-150 hover:bg-gold5/30 hover:outline-gold1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FontAwesomeIcon icon={faCheck} className="h-4" />
          {submitting
            ? 'Saving…'
            : placedCount < MIN_PLACED
              ? `Place ${MIN_PLACED - placedCount} more to submit`
              : 'Submit tier list'}
        </button>
      </div>
    </div>
  )
}

// ─── compare ───────────────────────────────────────────────────────────────

function CompareView({
  rows,
  onAnother,
  boardTitle,
}: {
  rows: TierResultRow[]
  onAnother: () => void
  boardTitle: string
}) {
  return (
    <div className="container mx-auto max-w-3xl px-4 pt-28 pb-16 md:px-6">
      <header className="animate-fade-up mb-6 text-center">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Your verdict is in
        </p>
        <h1 className="font-serif text-3xl font-bold text-gold1 md:text-4xl">
          {boardTitle.replace(/^Rank /, '')}
        </h1>
        <p className="mt-2 text-sm text-grey1">
          How your tiers stack up against the community.
        </p>
      </header>

      <ol className="flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.skinId}
            className="flex items-center gap-3 bg-hextech-black/30 p-2 outline outline-icon/10 -outline-offset-1"
          >
            <img
              src={r.splashUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-12 w-20 shrink-0 object-cover outline outline-icon/20 -outline-offset-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gold1">{r.name}</p>
              <p className="truncate text-xs text-grey1/60">{r.championName}</p>
              {r.agreementPct !== null && (
                <p className="mt-0.5 text-xs text-grey1">
                  <FontAwesomeIcon
                    icon={faUsers}
                    className="mr-1 h-3 text-gold2/70"
                  />
                  {r.agreementPct}% placed it in {r.yourTier}
                </p>
              )}
            </div>
            {r.hotTake && (
              <span className="flex shrink-0 items-center gap-1 bg-blue5/30 px-2 py-0.5 text-[11px] font-bold text-blue1 outline outline-blue3/50 -outline-offset-1">
                <FontAwesomeIcon icon={faBolt} className="h-3" />
                Hot take
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1.5 text-right">
              <TierBadge tier={r.yourTier} label="you" />
              <FontAwesomeIcon
                icon={faArrowRight}
                className="h-3 text-grey1/40"
              />
              <TierBadge tier={r.communityTier} label="all" />
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          onClick={onAnother}
          className="flex cursor-pointer items-center gap-2 bg-gold5/20 px-6 py-3 font-serif text-lg font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 transition duration-150 hover:bg-gold5/30 hover:outline-gold1"
        >
          <FontAwesomeIcon icon={faRotate} className="h-4" />
          Rank another
        </button>
        <Link
          to="/rankings"
          className="text-sm text-grey1 underline-offset-2 transition duration-150 hover:text-gold1 hover:underline"
        >
          See the full rankings your verdicts build →
        </Link>
      </div>
    </div>
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
