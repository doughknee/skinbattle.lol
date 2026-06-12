import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faCoins,
  faFire,
  faShareNodes,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { fetchPriceCheck, submitPriceGuess } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'
import type { PriceCheckState, PriceRoundResult } from '~/lib/games/types'

export const Route = createFileRoute('/battle/price-check')({
  // Data loads BEFORE the route renders (SSR on first visit, prefetched on
  // navigation) — the page arrives complete, no loading states.
  loader: () => fetchPriceCheck({ data: { restoreToken: guestRestoreToken() } }),
  head: () => ({
    meta: [
      { title: 'Price Check — Skin Battle' },
      {
        name: 'description',
        content:
          'Five League skins a day — guess what each one cost in RP. Legacy relics included.',
      },
      ...ogMeta({
        title: 'Price Check — Skin Battle',
        description:
          'Five League skins a day — guess what each one cost in RP. Legacy relics included.',
        card: 'price-check',
        path: '/battle/price-check',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load today's Price Check"
      message={error.message}
      back={{ to: '/battle', label: 'Back to the battle' }}
    />
  ),
  component: PriceCheckPage,
})

const rp = (v: number) => `${v.toLocaleString()} RP`

// ─── results board ──────────────────────────────────────────────────────────

// Fixed five-slot board (same contract as Splashdle's six-slot board): the
// page's height never changes as rounds fill in.
function ResultsBoard({
  results,
  totalRounds,
}: {
  results: PriceRoundResult[]
  totalRounds: number
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {Array.from({ length: totalRounds }, (_, i) => {
        const r = results[i]
        if (!r) {
          return (
            <li
              key={i}
              className="flex h-11 items-center bg-hextech-black/30 px-3 text-sm text-grey1/50 outline outline-icon/10 -outline-offset-1"
            >
              Round {i + 1}
            </li>
          )
        }
        const mark = r.correct ? '🟩' : r.oneOff ? '🟨' : '🟥'
        return (
          <li
            key={i}
            className={`flex h-11 items-center gap-2 overflow-hidden whitespace-nowrap bg-hextech-black/30 px-3 text-sm outline outline-icon/10 -outline-offset-1 ${
              i === results.length - 1 ? 'animate-history-in' : ''
            }`}
          >
            <span className="shrink-0">{mark}</span>
            <span className="min-w-0 truncate font-bold text-gold1">{r.name}</span>
            <span className="ml-auto shrink-0 text-grey1">
              {r.correct ? (
                <b className="text-blue2">{rp(r.actual)}</b>
              ) : (
                <>
                  you said {rp(r.guess)} · <b className="text-gold1">{rp(r.actual)}</b>
                </>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ─── feedback line ──────────────────────────────────────────────────────────

// Fixed-height: exists from first paint, only its content swaps.
function FeedbackBar({
  last,
  finished,
}: {
  last: PriceRoundResult | null
  finished: boolean
}) {
  return (
    <div className="flex h-14 items-center justify-center overflow-hidden px-2 text-center">
      {last ? (
        <p
          key={last.skinId}
          className="animate-feedback-pop flex flex-wrap items-baseline justify-center gap-x-2 text-sm md:text-base"
        >
          {last.correct ? (
            <span className="font-bold text-blue2">{rp(last.actual)} — exact!</span>
          ) : (
            <span className="text-grey1">
              <b className="text-gold1">{rp(last.actual)}</b>
              {last.oneOff ? ' — one tier off' : ` — you said ${rp(last.guess)}`}
            </span>
          )}
          {last.legacy && (
            <span className="text-grey1">
              · Legacy vault — not even buyable anymore
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-grey1">
          {finished
            ? 'Come back tomorrow for five fresh skins.'
            : 'How much did this skin cost on release day? Pure gut feel.'}
        </p>
      )}
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

function PriceCheckPage() {
  const initial = Route.useLoaderData()
  const [state, setState] = useState<PriceCheckState>(initial)
  const busyRef = useRef(false)
  const playedRef = useRef(false)

  useEffect(() => {
    rememberGuestToken(state.guestToken)
  }, [state.guestToken])

  const guess = useCallback(async (tier: number) => {
    if (busyRef.current) return
    busyRef.current = true
    playedRef.current = true
    try {
      const next = await submitPriceGuess({
        data: { tier, restoreToken: guestRestoreToken() },
      })
      setState(next)
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "That guess didn't count — try again.",
        'error',
      )
    } finally {
      busyRef.current = false
    }
  }, [])

  const share = async () => {
    if (!state.shareText) return
    try {
      await navigator.clipboard.writeText(state.shareText)
      toast('Result copied — go flex it!')
    } catch {
      toast("Couldn't copy to clipboard.", 'error')
    }
  }

  const finished = state.status !== 'in_progress'
  const last = state.results[state.results.length - 1] ?? null
  // The viewport shows the round in play, or the final answered skin.
  const shown = state.current ?? last

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Daily · what did it cost?
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
            Price Ch<span className="italic">eck</span> #{state.puzzleNumber}
          </h1>
          <p className="text-sm text-grey1">
            {finished ? (
              <>
                <b className="text-gold1">{state.score}</b>/{state.totalRounds}{' '}
                exact
              </>
            ) : (
              <>
                Round <b className="text-gold1">{state.current?.round}</b> of{' '}
                {state.totalRounds} · {state.score} exact
              </>
            )}
          </p>
        </div>
      </header>

      {/* Splash viewport — fixed aspect so nothing below it ever moves.
          Keyed per skin so each round's art plays one entrance. */}
      <div className="relative aspect-video w-full overflow-hidden bg-hextech-black/60 outline outline-icon/20 -outline-offset-2">
        {shown && (
          <img
            key={shown.skinId}
            src={shown.splashUrl}
            alt={`${shown.name} splash art`}
            loading="eager"
            decoding="async"
            className={`h-full w-full object-cover ${playedRef.current ? 'animate-fade-in' : ''}`}
          />
        )}
        {shown && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-hextech-black/95 via-hextech-black/60 to-transparent px-4 pb-3 pt-10">
            <span className="font-serif text-lg font-bold leading-tight text-gold1 md:text-xl">
              {shown.name}
            </span>
            <span className="text-sm text-grey1">{shown.championName}</span>
          </span>
        )}
      </div>

      <FeedbackBar last={last} finished={finished} />

      {/* Tier buttons — always present at fixed height; disabled once done. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {state.tiers.map((t) => (
          <button
            key={t}
            onClick={() => void guess(t)}
            disabled={finished}
            className="flex h-12 cursor-pointer items-center justify-center bg-hextech-black/40 font-serif font-bold text-gold1 outline outline-icon/30 -outline-offset-2 transition duration-150 hover:bg-gold5/30 hover:outline-gold2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.toLocaleString()}
          </button>
        ))}
      </div>

      <section className="mt-8">
        <ResultsBoard results={state.results} totalRounds={state.totalRounds} />
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {finished && (
          <button onClick={share} className={btnPrimarySm}>
            <FontAwesomeIcon icon={faShareNodes} className="h-4" />
            Share result
          </button>
        )}
        <Link to="/battle" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          Back to the battle
        </Link>
        {state.streak.current > 0 && (
          <span className="flex items-center gap-1.5 text-sm font-bold text-gold2">
            <FontAwesomeIcon icon={faFire} className="h-3.5" />
            {state.streak.current}-day streak
            {state.streak.best > state.streak.current && (
              <span className="font-normal text-grey1"> · best {state.streak.best}</span>
            )}
          </span>
        )}
        {finished && state.status === 'won' && (
          <span className="flex items-center gap-1.5 text-sm text-grey1">
            <FontAwesomeIcon icon={faCoins} className="h-3.5 text-gold2" />
            Sharp eye for the shop.
          </span>
        )}
      </div>
    </div>
  )
}
