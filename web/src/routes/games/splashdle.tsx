import { createFileRoute, Link } from '@tanstack/react-router'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faCheck,
  faCircleNotch,
  faFire,
  faMagnifyingGlass,
  faShareNodes,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
import SkeletonSwap from '~/components/SkeletonSwap'
import { toast } from '~/components/Toaster'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import {
  fetchSplashdleOptions,
  fetchSplashdleState,
  submitSplashdleGuess,
} from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import type {
  GuessOption,
  SplashdleGuess,
  SplashdleState,
} from '~/lib/games/types'

export const Route = createFileRoute('/games/splashdle')({
  head: () => ({
    meta: [
      { title: 'Splashdle — Skin Battle' },
      {
        name: 'description',
        content:
          'Name the League skin from a sliver of its splash art. A new puzzle every day.',
      },
    ],
  }),
  component: SplashdlePage,
})

// ─── splash viewport ────────────────────────────────────────────────────────

// An image that stays invisible until it has actually decoded, then plays
// its entrance. Without the gate, the animation runs against an empty box
// (worst on the final reveal, which is a network fetch) and reads as flash.
function LoadedSplash({
  src,
  anim,
  alt,
  onLoaded,
}: {
  src: string
  anim: string
  alt: string
  onLoaded?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const mark = () => {
    setLoaded(true)
    onLoaded?.()
  }
  return (
    <img
      src={src}
      alt={alt}
      ref={(el) => {
        if (el?.complete) mark()
      }}
      onLoad={mark}
      className={`relative h-full w-full object-cover ${loaded ? anim : 'opacity-0'}`}
    />
  )
}

// The previous crop stays mounted beneath the incoming one, so each zoom
// step is a crossfade between crops — never a blink through the dark
// figure background.
function SplashViewport({
  state,
  shake,
  soft,
  onImageLoaded,
}: {
  state: SplashdleState
  shake: boolean
  // True while showing the image that was already current at page load:
  // it replaces a skeleton, so it materializes with a plain fade instead
  // of playing a zoom/reveal entrance on top of the loading state.
  soft: boolean
  // Lets the page know the region is visually ready (drives SkeletonSwap).
  onImageLoaded?: () => void
}) {
  const playing = state.status === 'in_progress'
  const [pair, setPair] = useState({
    current: state.image,
    prev: null as string | null,
  })
  // Derived-state pattern: track image changes during render so the old
  // layer is already in place the moment the new one mounts.
  if (state.image !== pair.current) {
    setPair({ current: state.image, prev: pair.current })
  }
  const anim = soft
    ? 'animate-fade-in'
    : playing
      ? 'animate-zoom-step'
      : 'animate-reveal-splash'
  return (
    <figure
      className={`relative aspect-video w-full overflow-hidden bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2 ${
        shake ? 'animate-shake' : ''
      }`}
    >
      {pair.prev && (
        <img
          src={pair.prev}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <LoadedSplash
        key={`${state.status}-${state.zoomLevel}`}
        src={pair.current}
        anim={anim}
        onLoaded={onImageLoaded}
        alt={
          playing
            ? 'A cropped sliver of a mystery skin splash'
            : `${state.answer?.name} splash art`
        }
      />
      {playing && (
        <figcaption className="absolute bottom-0 right-0 bg-hextech-black/70 px-3 py-1 text-xs font-bold uppercase tracking-widest text-gold2">
          Zoom {state.zoomLevel + 1}/{state.totalLevels}
        </figcaption>
      )}
    </figure>
  )
}

// ─── guess squares ──────────────────────────────────────────────────────────

function guessTone(g: SplashdleGuess): string {
  if (g.correct) return 'bg-emerald-700/80 outline-emerald-400/70'
  if (g.championMatch) return 'bg-gold4/70 outline-gold2/80'
  return 'bg-red-900/70 outline-red-400/50'
}

function GuessSlots({ state }: { state: SplashdleState }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: state.maxGuesses }, (_, i) => {
        const g = state.guesses[i]
        // Key flips when a slot fills so the square remounts and pops in.
        const justFilled = g && i === state.guesses.length - 1
        return (
          <span
            key={g ? `filled-${i}` : `empty-${i}`}
            className={`h-4 w-4 outline -outline-offset-1 ${
              g ? guessTone(g) : 'bg-hextech-black/40 outline-icon/30'
            } ${justFilled ? 'animate-tile-pop' : ''}`}
          />
        )
      })}
    </div>
  )
}

// ─── autocomplete guess input ───────────────────────────────────────────────

// Punctuation/case-insensitive matching: "project yi" must find
// "PROJECT: Yi", "kaisa" must find Kai'Sa skins, "kda" must find K/DA.
// Every query token has to prefix-match a word in the skin or champion name.
const stripAccents = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const norm = (s: string) =>
  stripAccents(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Each whitespace-delimited word is indexed both punctuation-split and
// punctuation-collapsed, so Kai'Sa answers to "kai sa" AND "kaisa", and
// K/DA to "k da" AND "kda".
function wordsOf(s: string): string[] {
  const out = new Set<string>()
  for (const raw of stripAccents(s).split(/\s+/)) {
    const collapsed = raw.replace(/[^a-z0-9]+/g, '')
    if (collapsed) out.add(collapsed)
    for (const part of raw.split(/[^a-z0-9]+/)) if (part) out.add(part)
  }
  return [...out]
}

interface SearchableOption {
  opt: GuessOption
  nameNorm: string
  words: string[]
}

function buildSearchable(options: GuessOption[]): SearchableOption[] {
  return options.map((opt) => ({
    opt,
    nameNorm: norm(opt.name),
    words: wordsOf(`${opt.name} ${opt.championName}`),
  }))
}

function matchOptions(
  searchable: SearchableOption[],
  query: string,
): GuessOption[] {
  const q = norm(query)
  if (q.length < 2) return []
  const tokens = q.split(' ')
  const starts: GuessOption[] = []
  const wordMatches: GuessOption[] = []
  for (const s of searchable) {
    if (s.nameNorm.startsWith(q)) starts.push(s.opt)
    else if (tokens.every((t) => s.words.some((w) => w.startsWith(t))))
      wordMatches.push(s.opt)
  }
  return [...starts, ...wordMatches].slice(0, 8)
}

// Gold-tint the words of a suggestion that the query matched, so the list
// shows WHY each result is there.
function HighlightedName({ name, query }: { name: string; query: string }) {
  const tokens = norm(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return <>{name}</>
  return (
    <>
      {name.split(/(\s+)/).map((part, i) => {
        const collapsed = norm(part).replace(/\s+/g, '')
        const hit = collapsed && tokens.some((t) => collapsed.startsWith(t))
        return hit ? (
          <span key={i} className="text-gold2">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

// Versionless Data Dragon loading portrait — small, cacheable, and gives the
// suggestion list faces instead of a wall of text.
const championPortrait = (championId: string) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championId}_0.jpg`

const finePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

function GuessInput({
  options,
  disabled,
  submitting,
  guessed,
  onSubmit,
}: {
  options: GuessOption[]
  disabled: boolean
  submitting: boolean
  guessed: Set<string>
  onSubmit: (opt: GuessOption) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GuessOption | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const searchable = useMemo(() => buildSearchable(options), [options])
  const matches = useMemo(
    () => (open ? matchOptions(searchable, query) : []),
    [searchable, query, open],
  )
  const noMatch =
    open && !selected && norm(query).length >= 2 && matches.length === 0

  // Keep the keyboard flow unbroken: focus on mount and re-focus the moment
  // a submission settles (mouse-only on touch devices — popping the soft
  // keyboard over the splash would hide the new crop).
  useEffect(() => {
    if (finePointer()) inputRef.current?.focus()
  }, [])
  const wasDisabled = useRef(disabled)
  useEffect(() => {
    if (wasDisabled.current && !disabled && finePointer()) {
      inputRef.current?.focus()
    }
    wasDisabled.current = disabled
  }, [disabled])

  const pick = (o: GuessOption) => {
    setSelected(o)
    setQuery(o.name)
    setOpen(false)
  }

  const submit = () => {
    if (!selected || disabled) return
    if (guessed.has(selected.skinId)) {
      toast('You already guessed that skin.', 'error')
      return
    }
    onSubmit(selected)
    setQuery('')
    setSelected(null)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        pick(matches[highlight])
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <FontAwesomeIcon
          icon={faMagnifyingGlass}
          className="pointer-events-none absolute left-4 top-1/2 h-4 -translate-y-1/2 text-gold2"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-autocomplete="list"
          aria-label="Guess the skin"
          placeholder="Start typing a skin name…"
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(null)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className={`h-12 w-full bg-hextech-black/40 pl-11 pr-4 text-gold1 placeholder-grey1 outline -outline-offset-1 transition duration-150 hover:outline-icon focus:outline-gold2 disabled:cursor-not-allowed disabled:opacity-40 ${
            selected ? 'outline-gold2/70' : 'outline-icon/30'
          }`}
        />
        {open && matches.length > 0 && (
          <ul
            role="listbox"
            className="animate-pop absolute z-20 mt-1 max-h-96 w-full overflow-y-auto bg-hextech-black/95 outline outline-icon/30 -outline-offset-1 backdrop-blur-xl"
          >
            {matches.map((o, i) => {
              const used = guessed.has(o.skinId)
              return (
                <li
                  key={o.skinId}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (!used) pick(o)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-75 ${
                    i === highlight ? 'bg-gold5/20' : ''
                  } ${used ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <img
                    src={championPortrait(o.championId)}
                    loading="lazy"
                    alt=""
                    className="h-10 w-8 shrink-0 object-cover object-top outline outline-icon/20 -outline-offset-1"
                  />
                  <span className="min-w-0 truncate font-bold text-gold1">
                    <HighlightedName name={o.name} query={query} />
                  </span>
                  <span className="ml-auto shrink-0 text-sm text-grey1">
                    {used ? 'guessed' : o.championName}
                  </span>
                </li>
              )
            })}
            <li
              aria-hidden
              className="hidden border-t border-icon/20 px-3 py-1.5 text-[11px] uppercase tracking-widest text-grey1 sm:block"
            >
              ↑↓ navigate · Enter select · Enter again to guess
            </li>
          </ul>
        )}
        {noMatch && (
          <div className="animate-pop absolute z-20 mt-1 w-full bg-hextech-black/95 px-4 py-3 text-sm text-grey1 outline outline-icon/30 -outline-offset-1 backdrop-blur-xl">
            No skins match "{query.trim()}" — try the champion's name.
          </div>
        )}
      </div>
      <button
        onClick={submit}
        disabled={disabled || !selected}
        className={btnPrimarySm}
      >
        {submitting && (
          <FontAwesomeIcon icon={faCircleNotch} className="h-4 animate-spin" />
        )}
        Guess
      </button>
    </div>
  )
}

// ─── guess board ────────────────────────────────────────────────────────────

// All six slots are always rendered (Wordle-style), chronological top-down.
// Fixed board = fixed page height: the footer never moves during a game.
// Each slot's CONTENT is keyed, so empty → pending → verdict transitions
// animate while the rows themselves stay perfectly still.
function GuessBoard({
  guesses,
  pending,
  maxGuesses,
  animateFrom = 0,
}: {
  guesses: SplashdleGuess[]
  pending?: GuessOption | null
  maxGuesses: number
  // Slots below this index were already filled when the page loaded — they
  // replace a skeleton, so they render settled instead of replaying their
  // entrance over the loading state.
  animateFrom?: number
}) {
  return (
    <ol className="flex flex-col gap-2">
      {Array.from({ length: maxGuesses }, (_, i) => {
        const g = guesses[i]
        const isPending = !g && pending && i === guesses.length
        const animate = i >= animateFrom
        return (
          <li
            key={i}
            className={`flex h-11 items-center gap-3 px-4 outline -outline-offset-1 transition-colors duration-300 ${
              g || isPending
                ? 'bg-hextech-black/30 outline-icon/20'
                : 'bg-hextech-black/20 outline-icon/10'
            }`}
          >
            {g ? (
              <div
                key={`guess-${g.skinId}`}
                className={`flex min-w-0 flex-1 items-center gap-3 ${animate ? 'animate-fade-in' : ''}`}
              >
                <span
                  className={`h-3.5 w-3.5 shrink-0 outline -outline-offset-1 ${guessTone(g)} ${
                    animate && i === guesses.length - 1 ? 'animate-tile-pop' : ''
                  }`}
                />
                <span className="min-w-0 truncate font-bold text-gold1">
                  {g.name}
                </span>
                <span className="ml-auto shrink-0 text-sm text-grey1">
                  {g.championMatch ? (
                    <span className="font-bold text-gold2">
                      Right champion, wrong skin
                    </span>
                  ) : (
                    g.championName
                  )}
                </span>
              </div>
            ) : isPending ? (
              <div
                key="pending"
                className="animate-fade-in flex min-w-0 flex-1 items-center gap-3"
              >
                <span className="skeleton h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate font-bold text-grey1">
                  {pending.name}
                </span>
                <span className="ml-auto shrink-0 text-sm text-grey1">
                  {pending.championName}
                </span>
              </div>
            ) : (
              <>
                <span className="h-3.5 w-3.5 shrink-0 bg-hextech-black/40 outline outline-icon/20 -outline-offset-1" />
                <span className="text-sm font-bold text-grey1/40">
                  Guess {i + 1}
                </span>
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ─── result panel ───────────────────────────────────────────────────────────

function nextPuzzleCountdown(): string {
  const now = new Date()
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )
  const mins = Math.max(0, Math.floor((next - now.getTime()) / 60_000))
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function ResultPanel({
  state,
  animate,
}: {
  state: SplashdleState
  // False when the page loaded already-finished: the panel replaces a
  // skeleton, so the celebratory cascade only plays for a live win.
  animate: boolean
}) {
  const [countdown, setCountdown] = useState(nextPuzzleCountdown)

  useEffect(() => {
    const t = setInterval(() => setCountdown(nextPuzzleCountdown()), 30_000)
    return () => clearInterval(t)
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

  const won = state.status === 'won'
  const answer = state.answer!

  return (
    <div className={`flex flex-col gap-5 ${animate ? 'stagger' : ''}`}>
      <div>
        <p className="mb-1 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          {won
            ? `Solved in ${state.guesses.length}/${state.maxGuesses}`
            : 'Out of guesses'}
        </p>
        <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold1">
          {answer.name}
        </h2>
        <p className="text-grey1">{answer.championName}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <GuessSlots state={state} />
        {state.streak.current > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1 text-sm font-bold text-gold2 outline outline-icon/30 -outline-offset-1">
            <FontAwesomeIcon icon={faFire} className="h-3.5" />
            {state.streak.current}-day streak
          </span>
        )}
        {state.streak.best > 1 && (
          <span className="text-sm text-grey1">Best: {state.streak.best}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={share} className={`group ${btnPrimarySm}`}>
          <FontAwesomeIcon icon={faShareNodes} className="h-4" />
          Share result
        </button>
        <Link to="/games" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          Daily Hub
        </Link>
        <span className="text-sm text-grey1">
          Next Splashdle in {countdown}
        </span>
      </div>
    </div>
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

function SplashdlePage() {
  const [state, setState] = useState<SplashdleState | null>(null)
  const [options, setOptions] = useState<GuessOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState<GuessOption | null>(null)
  // Flips when the first crop has decoded — the splash skeleton dissolves
  // on this, not on data arrival.
  const [imgReady, setImgReady] = useState(false)
  const [shake, setShake] = useState(false)
  const shakeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(shakeTimer.current), [])

  // What the board looked like when the page loaded. Content present at
  // load swaps in from the skeletons without entrance animations — playing
  // an entrance on top of a skeleton reads as a flash. Only things that
  // happen after load (new guesses, the live win) animate.
  const loadedWith = useRef<{ guessCount: number; finished: boolean } | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    fetchSplashdleState({ data: { restoreToken: guestRestoreToken() } })
      .then((s) => {
        if (cancelled) return
        rememberGuestToken(s.guestToken)
        loadedWith.current ??= {
          guessCount: s.guesses.length,
          finished: s.status !== 'in_progress',
        }
        setState(s)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Something went wrong.')
      })
    fetchSplashdleOptions()
      .then((o) => {
        if (!cancelled) setOptions(o)
      })
      .catch(() => {
        /* the state call surfaces connectivity errors */
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
      // A full miss jolts the splash; a near-miss (right champion) doesn't —
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

  if (error) {
    return (
      <ErrorState
        title="Couldn't load today's Splashdle"
        message={error}
        back={{ to: '/games', label: 'Back to games' }}
      />
    )
  }

  const playing = state?.status === 'in_progress'
  const guessedIds = new Set(state?.guesses.map((g) => g.skinId) ?? [])
  // Still showing exactly what was on the board at page load?
  const atLoadState =
    !!state &&
    !!loadedWith.current &&
    state.guesses.length === loadedWith.current.guessCount &&
    !playing === loadedWith.current.finished
  const animateFrom = loadedWith.current?.guessCount ?? 0

  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Daily · guess the skin
        </p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-gold1">
            Splashdle{' '}
            {state && <span className="text-gold2">#{state.puzzleNumber}</span>}
          </h1>
          {state && playing && (
            <span className="text-grey1">
              Guess {state.guesses.length + 1} of {state.maxGuesses}
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {/* The splash. While playing this is a server-cropped sliver that
            pulls back with every miss; on completion it's the full reveal.
            Its skeleton dissolves only once the first image has DECODED —
            data arriving isn't visually ready yet. */}
        <SkeletonSwap
          ready={!!state && imgReady}
          skeleton={<div className="skeleton aspect-video w-full" />}
        >
          {state && (
            <SplashViewport
              state={state}
              shake={shake}
              soft={atLoadState}
              onImageLoaded={() => setImgReady(true)}
            />
          )}
        </SkeletonSwap>

        <SkeletonSwap
          ready={!!state}
          skeleton={
            <div className="flex flex-col gap-6">
              <div className="skeleton h-12 w-full" />
              <div className="skeleton h-5 w-72 max-w-full" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="skeleton h-11 w-full" />
                ))}
              </div>
            </div>
          }
        >
          {state && (
            <div className="flex flex-col gap-6">
              {playing ? (
            <>
              <GuessInput
                options={options}
                disabled={submitting || options.length === 0}
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
              <ResultPanel state={state} animate={!loadedWith.current?.finished} />
              <GuessBoard
                guesses={state.guesses}
                maxGuesses={state.maxGuesses}
                animateFrom={animateFrom}
              />
            </>
          )}
            </div>
          )}
        </SkeletonSwap>
      </div>
    </div>
  )
}
