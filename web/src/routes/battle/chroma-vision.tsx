import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFire, faPalette } from '@fortawesome/free-solid-svg-icons'
import { usePostHog } from 'posthog-js/react'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import {
  GuessBoard,
  GuessInput,
  GuessViewport,
  ResultPanel,
} from '~/components/games/GuessKit'
import {
  fetchChromaVision,
  fetchDailyHub,
  fetchSplashdleOptions,
  submitChromaGuess,
} from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'
import TodayStrip from '~/components/games/TodayStrip'
import GameBreadcrumb from '~/components/games/GameBreadcrumb'
import type { ChromaVisionState, GuessOption } from '~/lib/games/types'

export const Route = createFileRoute('/battle/chroma-vision')({
  // Data loads BEFORE the route renders (SSR on first visit, prefetched on
  // navigation), and the mosaic ships inside the payload as a data URL -
  // the page arrives complete in one paint, no loading states. The modes
  // strip loads alongside so it's part of the same first paint.
  loader: async () => {
    const restoreToken = guestRestoreToken()
    const [state, hub] = await Promise.all([
      fetchChromaVision({ data: { restoreToken } }),
      fetchDailyHub({ data: { restoreToken } }),
    ])
    return { state, hub }
  },
  head: () => ({
    meta: [
      { title: 'Chroma Vision · Skin Battle' },
      {
        name: 'description',
        content:
          'Name the League skin from its colors alone. The mosaic sharpens with every miss. Six guesses, hard mode.',
      },
      ...ogMeta({
        title: 'Chroma Vision · Skin Battle',
        description:
          'Name the League skin from its colors alone. The mosaic sharpens with every miss. Six guesses, hard mode.',
        card: 'chroma-vision',
        path: '/battle/chroma-vision',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load today's Chroma Vision"
      message={error.message}
      back={{ to: '/battle', label: 'Back to the battle' }}
    />
  ),
  component: ChromaVisionPage,
})

function ChromaVisionPage() {
  const { state: initial, hub } = Route.useLoaderData()
  const posthog = usePostHog()
  const [state, setState] = useState<ChromaVisionState>(initial)
  const [options, setOptions] = useState<GuessOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState<GuessOption | null>(null)
  const [shake, setShake] = useState(false)
  const shakeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(shakeTimer.current), [])

  // One-time entrance: content cascades up on mount, then we drop the
  // `stagger` class once the cascade is done. Without this, nodes that mount
  // later (the result panel on finish) would inherit a fresh cascade animation
  // that never starts - leaving them stuck invisible. Replays on every
  // navigation since the page remounts, so swapping games feels deliberate.
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setEntering(false), 800)
    return () => window.clearTimeout(t)
  }, [])

  // What the board looked like on the page's first paint - that content
  // renders settled; only post-load guesses play game animations.
  const loadedWith = useRef({
    guessCount: initial.guesses.length,
    finished: initial.status !== 'in_progress',
  })

  // Resync if the route loader refreshes while mounted.
  useEffect(() => {
    setState(initial)
  }, [initial])

  // Mirror the guest token to localStorage as a cookie backup.
  useEffect(() => {
    rememberGuestToken(state.guestToken)
  }, [state.guestToken])

  // The autocomplete list (the full skin catalog, shared with Splashdle)
  // loads in the background; it's only needed once the player types.
  useEffect(() => {
    let cancelled = false
    fetchSplashdleOptions()
      .then((o) => {
        if (!cancelled) setOptions(o)
      })
      .catch(() => {
        /* the dropdown shows a loading row until it arrives */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const guess = useCallback(async (opt: GuessOption) => {
    setSubmitting(true)
    setPending(opt)
    try {
      const next = await submitChromaGuess({
        data: { skinId: opt.skinId, restoreToken: guestRestoreToken() },
      })
      rememberGuestToken(next.guestToken)
      const last = next.guesses[next.guesses.length - 1]
      posthog.capture('chromavision_guess_submitted', {
        puzzle_number: next.puzzleNumber,
        guess_number: next.guesses.length,
        correct: last?.correct ?? false,
        champion_match: last?.championMatch ?? false,
        guessed_skin_id: opt.skinId,
      })
      if (next.status !== 'in_progress') {
        posthog.capture('chromavision_completed', {
          puzzle_number: next.puzzleNumber,
          outcome: next.status,
          guesses_used: next.guesses.length,
          max_guesses: next.maxGuesses,
          streak: next.streak.current,
        })
      }
      // Full miss jolts the mosaic; a right-champion near-miss doesn't.
      // Cleared on a timer, never animationend (backgrounded tabs).
      if (last && !last.correct && !last.championMatch) {
        setShake(true)
        window.clearTimeout(shakeTimer.current)
        shakeTimer.current = window.setTimeout(() => setShake(false), 600)
      }
      setState(next)
    } catch (err) {
      toast(
        err instanceof Error ? err.message : 'Something went wrong.',
        'error',
      )
    } finally {
      setPending(null)
      setSubmitting(false)
    }
  }, [posthog])

  const playing = state.status === 'in_progress'
  const guessedIds = new Set(state.guesses.map((g) => g.skinId))
  const atLoadState =
    state.guesses.length === loadedWith.current.guessCount &&
    !playing === loadedWith.current.finished
  const animateFrom = loadedWith.current.guessCount

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <GameBreadcrumb label="Chroma Vision" />
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Daily · hard mode · colors only
        </p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
            Chroma Vision{' '}
            <span className="text-gold2">#{state.puzzleNumber}</span>
          </h1>
          {playing && (
            <span className="text-grey1">
              Guess {state.guesses.length + 1} of {state.maxGuesses}
            </span>
          )}
        </div>
      </header>

      {/* Content cascades up on mount (see `entering`); the class drops once
          the cascade finishes so the result panel can mount cleanly later. */}
      <div className={`${entering ? 'stagger ' : ''}flex flex-col gap-6`}>
        {/* The mosaic: pure color composition at first, the silhouette
            emerging block by block with each miss; the full reveal at the end.
            Wrapped so the cascade's fade-up lands on this div, not the figure
            (whose own shake/reveal animations would collide). */}
        <div>
          <GuessViewport
            image={state.image}
            levelKey={`${state.status}-${state.zoomLevel}`}
            playing={playing}
            shake={shake}
            soft={atLoadState}
            caption={`Mosaic ${state.zoomLevel + 1}/${state.totalLevels}`}
            playingAlt="A color mosaic of a mystery skin splash"
            answerName={state.answer?.name}
          />
        </div>

        {playing ? (
          <>
            <GuessInput
              options={options}
              disabled={submitting}
              submitting={submitting}
              guessed={guessedIds}
              onSubmit={guess}
            />
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-grey1">
              <span>
                <FontAwesomeIcon
                  icon={faPalette}
                  className="mr-1.5 h-3 text-gold2"
                />
                It's all in the palette. Wrong guesses sharpen the mosaic: a
                gold square means right champion, wrong skin.
              </span>
              {state.streak.current > 0 && (
                <span className="flex items-center gap-1.5 font-bold text-gold2">
                  <FontAwesomeIcon icon={faFire} className="h-3.5" />
                  {state.streak.current}-day streak on the line
                </span>
              )}
            </p>
            <GuessBoard
              guesses={state.guesses}
              pending={pending}
              maxGuesses={state.maxGuesses}
              animateFrom={animateFrom}
              counts={state.guessCounts}
            />
          </>
        ) : (
          <>
            <ResultPanel
              status={state.status as 'won' | 'lost'}
              guesses={state.guesses}
              maxGuesses={state.maxGuesses}
              streak={state.streak}
              answer={state.answer!}
              shareText={state.shareText}
              animate={!loadedWith.current.finished}
              gameName="Chroma Vision"
            />
            <GuessBoard
              guesses={state.guesses}
              maxGuesses={state.maxGuesses}
              animateFrom={animateFrom}
              counts={state.guessCounts}
            />
          </>
        )}
      </div>

      <TodayStrip hub={hub} current="chroma-vision" />
    </div>
  )
}
