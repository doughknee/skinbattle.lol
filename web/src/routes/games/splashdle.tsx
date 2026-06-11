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
  faFire,
  faMagnifyingGlass,
  faShareNodes,
} from '@fortawesome/free-solid-svg-icons'
import ErrorState from '~/components/ErrorState'
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
        return (
          <span
            key={i}
            className={`h-4 w-4 outline -outline-offset-1 ${
              g ? guessTone(g) : 'bg-hextech-black/40 outline-icon/30'
            }`}
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

function GuessInput({
  options,
  disabled,
  guessed,
  onSubmit,
}: {
  options: GuessOption[]
  disabled: boolean
  guessed: Set<string>
  onSubmit: (skinId: string) => void
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
    onSubmit(selected.skinId)
    setQuery('')
    setSelected(null)
    setOpen(false)
    inputRef.current?.focus()
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
          className="h-12 w-full bg-hextech-black/40 pl-11 pr-4 text-gold1 placeholder-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:outline-icon focus:outline-gold2 disabled:cursor-not-allowed disabled:opacity-40"
        />
        {open && matches.length > 0 && (
          <ul
            role="listbox"
            className="animate-pop absolute z-20 mt-1 max-h-80 w-full overflow-y-auto bg-hextech-black/95 outline outline-icon/30 -outline-offset-1 backdrop-blur-xl"
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
                  className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2.5 ${
                    i === highlight ? 'bg-gold5/20' : ''
                  } ${used ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <span className="font-bold text-gold1">{o.name}</span>
                  <span className="shrink-0 text-sm text-grey1">
                    {o.championName}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <button
        onClick={submit}
        disabled={disabled || !selected}
        className={btnPrimarySm}
      >
        Guess
      </button>
    </div>
  )
}

// ─── past guesses ───────────────────────────────────────────────────────────

function GuessHistory({ guesses }: { guesses: SplashdleGuess[] }) {
  if (guesses.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {[...guesses].reverse().map((g) => (
        <li
          key={g.skinId}
          className="animate-fade-in flex items-center gap-3 bg-hextech-black/30 px-4 py-2.5 outline outline-icon/20 -outline-offset-1"
        >
          <span
            className={`h-3.5 w-3.5 shrink-0 outline -outline-offset-1 ${guessTone(g)}`}
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
        </li>
      ))}
    </ul>
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

function ResultPanel({ state }: { state: SplashdleState }) {
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
    <div className="animate-fade-up flex flex-col gap-5">
      <div>
        <p className="mb-1 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          {won ? `Solved in ${state.guesses.length}/${state.maxGuesses}` : 'Out of guesses'}
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
          <span className="text-sm text-grey1">
            Best: {state.streak.best}
          </span>
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

  useEffect(() => {
    let cancelled = false
    fetchSplashdleState({ data: { restoreToken: guestRestoreToken() } })
      .then((s) => {
        if (cancelled) return
        rememberGuestToken(s.guestToken)
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

  const guess = useCallback(
    async (skinId: string) => {
      setSubmitting(true)
      try {
        const next = await submitSplashdleGuess({
          data: { skinId, restoreToken: guestRestoreToken() },
        })
        rememberGuestToken(next.guestToken)
        setState(next)
      } catch (err) {
        toast(
          err instanceof Error ? err.message : 'Something went wrong.',
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [],
  )

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

      {!state ? (
        <div className="flex flex-col gap-4">
          <div className="skeleton aspect-video w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* The splash. While playing this is a server-cropped sliver that
              widens with every miss; on completion it's the full reveal. */}
          <figure className="relative aspect-video w-full overflow-hidden bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
            <img
              key={`${state.status}-${state.zoomLevel}`}
              src={state.image}
              alt={
                playing
                  ? 'A cropped sliver of a mystery skin splash'
                  : `${state.answer?.name} splash art`
              }
              className="animate-fade-in h-full w-full object-cover"
            />
            {playing && (
              <figcaption className="absolute bottom-0 right-0 bg-hextech-black/70 px-3 py-1 text-xs font-bold uppercase tracking-widest text-gold2">
                Zoom {state.zoomLevel + 1}/{state.totalLevels}
              </figcaption>
            )}
          </figure>

          {playing ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <GuessSlots state={state} />
                {state.streak.current > 0 && (
                  <span className="flex items-center gap-1.5 text-sm font-bold text-gold2">
                    <FontAwesomeIcon icon={faFire} className="h-3.5" />
                    {state.streak.current}-day streak on the line
                  </span>
                )}
              </div>
              <GuessInput
                options={options}
                disabled={submitting || options.length === 0}
                guessed={guessedIds}
                onSubmit={guess}
              />
              <GuessHistory guesses={state.guesses} />
              <p className="text-sm text-grey1">
                <FontAwesomeIcon icon={faCheck} className="mr-1.5 h-3 text-gold2" />
                Wrong guesses zoom the splash out. A gold square means you
                named the right champion's wrong skin.
              </p>
            </>
          ) : (
            <>
              <ResultPanel state={state} />
              <GuessHistory guesses={state.guesses} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
