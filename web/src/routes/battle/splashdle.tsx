import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faFire } from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import { toast } from '~/components/Toaster'
import {
  GuessBoard,
  GuessInput,
  GuessViewport,
  ResultPanel,
} from '~/components/games/GuessKit'
import {
  fetchSplashdleOptions,
  fetchSplashdleState,
  submitSplashdleGuess,
} from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'
import type { GuessOption, SplashdleState } from '~/lib/games/types'

export const Route = createFileRoute('/battle/splashdle')({
  // Data loads BEFORE the route renders (SSR on first visit, prefetched on
  // navigation), and the crop ships inside the payload as a data URL - the
  // page arrives complete in one paint, so there are no loading states.
  loader: () =>
    fetchSplashdleState({ data: { restoreToken: guestRestoreToken() } }),
  head: () => ({
    meta: [
      { title: 'Splashdle · Skin Battle' },
      {
        name: 'description',
        content:
          'Name the League skin from a sliver of its splash art. A new puzzle every day.',
      },
      ...ogMeta({
        title: 'Splashdle · Skin Battle',
        description:
          'Name the League skin from a sliver of its splash art. It zooms out with every miss. Six guesses, new puzzle daily.',
        card: 'splashdle',
        path: '/battle/splashdle',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState
      title="Couldn't load today's Splashdle"
      message={error.message}
      back={{ to: '/battle', label: 'Back to the battle' }}
    />
  ),
  component: SplashdlePage,
})

function SplashdlePage() {
  const initial = Route.useLoaderData()
  const [state, setState] = useState<SplashdleState>(initial)
  const [options, setOptions] = useState<GuessOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState<GuessOption | null>(null)
  const [shake, setShake] = useState(false)
  const shakeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(shakeTimer.current), [])

  // What the board looked like on the page's first paint. That content is
  // part of the page entrance, so it renders settled - only things that
  // happen after load (new guesses, the live win) play game animations.
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

  // The autocomplete list loads in the background; it's only needed once
  // the player starts typing.
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
      const next = await submitSplashdleGuess({
        data: { skinId: opt.skinId, restoreToken: guestRestoreToken() },
      })
      rememberGuestToken(next.guestToken)
      const last = next.guesses[next.guesses.length - 1]
      // A full miss jolts the splash; a near-miss (right champion) doesn't -
      // warm should never feel like rejection. Cleared on a timer rather
      // than animationend, which never fires in a backgrounded tab.
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
  }, [])

  const playing = state.status === 'in_progress'
  const guessedIds = new Set(state.guesses.map((g) => g.skinId))
  // Still showing exactly what was on the board at first paint?
  const atLoadState =
    state.guesses.length === loadedWith.current.guessCount &&
    !playing === loadedWith.current.finished
  const animateFrom = loadedWith.current.guessCount

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Daily · guess the skin
        </p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
            Splashdle <span className="text-gold2">#{state.puzzleNumber}</span>
          </h1>
          {playing && (
            <span className="text-grey1">
              Guess {state.guesses.length + 1} of {state.maxGuesses}
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {/* The splash. While playing this is a server-cropped sliver that
            pulls back with every miss; on completion it's the full reveal. */}
        <GuessViewport
          image={state.image}
          levelKey={`${state.status}-${state.zoomLevel}`}
          playing={playing}
          shake={shake}
          soft={atLoadState}
          caption={`Zoom ${state.zoomLevel + 1}/${state.totalLevels}`}
          playingAlt="A cropped sliver of a mystery skin splash"
          answerName={state.answer?.name}
        />

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
                  icon={faCheck}
                  className="mr-1.5 h-3 text-gold2"
                />
                Wrong guesses zoom the splash out. A gold square means you
                named the right champion's wrong skin.
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
              gameName="Splashdle"
            />
            <GuessBoard
              guesses={state.guesses}
              maxGuesses={state.maxGuesses}
              animateFrom={animateFrom}
            />
          </>
        )}
      </div>
    </div>
  )
}
