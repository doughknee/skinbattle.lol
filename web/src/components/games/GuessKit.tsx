// Shared machinery for the guess-the-skin dailies (Splashdle, Chroma
// Vision): the autocomplete combobox, the fixed Wordle-style board, the
// guess squares, the image viewport, and the result panel. Both games keep
// their own engines and copy - this is the presentation they have in common.

import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faCircleNotch,
  faFire,
  faMagnifyingGlass,
  faShareNodes,
} from '@fortawesome/free-solid-svg-icons'
import { toast } from '~/components/Toaster'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'
import { skinSlug } from '~/lib/games/slug'
import { createSearcher, norm } from '~/lib/search'
import type {
  GuessOption,
  SplashdleAnswer,
  SplashdleGuess,
  StreakInfo,
} from '~/lib/games/types'

// ─── image viewport ─────────────────────────────────────────────────────────

// An image that stays invisible until it has actually decoded, then plays
// its entrance. Without the gate, the animation runs against an empty box
// (worst on the final reveal, which is a network fetch) and reads as flash.
function LoadedSplash({
  src,
  anim,
  alt,
}: {
  src: string
  anim: string
  alt: string
}) {
  // Data-URL images are already in memory - render immediately (this also
  // keeps the server-rendered first paint visible before hydration). Only
  // network images (the final reveal) wait for decode.
  const [loaded, setLoaded] = useState(() => src.startsWith('data:'))
  return (
    <img
      src={src}
      alt={alt}
      ref={(el) => {
        if (el?.complete) setLoaded(true)
      }}
      onLoad={() => setLoaded(true)}
      className={`relative h-full w-full object-cover ${loaded ? anim : 'opacity-0'}`}
    />
  )
}

// The previous image stays mounted beneath the incoming one, so each level
// step is a crossfade - never a blink through the dark figure background.
export function GuessViewport({
  image,
  levelKey,
  playing,
  shake,
  soft,
  caption,
  playingAlt,
  answerName,
}: {
  image: string
  // Changes per reveal step so the incoming layer remounts and animates.
  levelKey: string
  playing: boolean
  shake: boolean
  // True while showing the image that was already current at page load:
  // it's part of the page's first paint, so it gets a plain fade instead
  // of a zoom/reveal entrance.
  soft: boolean
  caption: string | null
  playingAlt: string
  answerName?: string
}) {
  const [pair, setPair] = useState({
    current: image,
    prev: null as string | null,
  })
  // Derived-state pattern: track image changes during render so the old
  // layer is already in place the moment the new one mounts.
  if (image !== pair.current) {
    setPair({ current: image, prev: pair.current })
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
        key={levelKey}
        src={pair.current}
        anim={anim}
        alt={playing ? playingAlt : `${answerName} splash art`}
      />
      {playing && caption && (
        <figcaption className="absolute bottom-0 right-0 bg-hextech-black/70 px-3 py-1 text-xs font-bold uppercase tracking-widest text-gold2">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

// ─── guess squares ──────────────────────────────────────────────────────────

function guessTone(g: SplashdleGuess): string {
  if (g.correct) return 'bg-success/80 outline-success-border/70'
  if (g.championMatch) return 'bg-gold4/70 outline-gold2/80'
  return 'bg-danger-surface/70 outline-danger-border/50'
}

export function GuessSlots({
  guesses,
  maxGuesses,
}: {
  guesses: SplashdleGuess[]
  maxGuesses: number
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: maxGuesses }, (_, i) => {
        const g = guesses[i]
        // Key flips when a slot fills so the square remounts and pops in.
        const justFilled = g && i === guesses.length - 1
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

const finePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

export function GuessInput({
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

  const searcher = useMemo(
    () =>
      createSearcher(options, {
        keys: [
          { name: 'name', weight: 0.7 },
          { name: 'championName', weight: 0.3 },
          // Index skin lines so you can find a skin by its theme ("Bewitching").
          { name: 'sets', weight: 0.3 },
        ],
        prefixFirst: true,
        // The dropdown scrolls, so the cap is about findability, not screen
        // space: it must clear the largest champion roster (23) and skin line
        // (36) or a guessable skin gets cut from the list. 50 covers both.
        limit: 50,
        minLength: 2,
      }),
    [options],
  )
  const matches = useMemo(
    () => (open ? searcher.search(query) : []),
    [searcher, query, open],
  )
  // The options list loads in the background after first paint; until it
  // arrives, typing shows a loading row - never a false "no skins match".
  const listLoading = options.length === 0
  const typed = open && !selected && norm(query).length >= 2
  const noMatch = typed && !listLoading && matches.length === 0

  // Keep the keyboard flow unbroken: focus on mount and re-focus the moment
  // a submission settles (mouse-only on touch devices - popping the soft
  // keyboard over the splash would hide the new image).
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
                    src={o.tileUrl}
                    loading="lazy"
                    alt=""
                    className="h-10 w-10 shrink-0 object-cover object-center outline outline-icon/20 -outline-offset-1"
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
        {typed && listLoading && (
          <div className="animate-pop absolute z-20 mt-1 w-full bg-hextech-black/95 px-4 py-3 text-sm text-grey1 outline outline-icon/30 -outline-offset-1 backdrop-blur-xl">
            Loading the skin list…
          </div>
        )}
        {noMatch && (
          <div className="animate-pop absolute z-20 mt-1 w-full bg-hextech-black/95 px-4 py-3 text-sm text-grey1 outline outline-icon/30 -outline-offset-1 backdrop-blur-xl">
            No skins match "{query.trim()}". Try the champion's name.
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

// All slots are always rendered (Wordle-style), chronological top-down.
// Fixed board = fixed page height: the footer never moves during a game.
// Each slot's CONTENT is keyed, so empty → pending → verdict transitions
// animate while the rows themselves stay perfectly still.
export function GuessBoard({
  guesses,
  pending,
  maxGuesses,
  animateFrom = 0,
}: {
  guesses: SplashdleGuess[]
  pending?: GuessOption | null
  maxGuesses: number
  // Slots below this index were already filled when the page loaded - they
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

export function ResultPanel({
  status,
  guesses,
  maxGuesses,
  streak,
  answer,
  shareText,
  animate,
  gameName,
}: {
  status: 'won' | 'lost'
  guesses: SplashdleGuess[]
  maxGuesses: number
  streak: StreakInfo
  answer: SplashdleAnswer
  shareText?: string
  // False when the page loaded already-finished: the panel replaces a
  // skeleton, so the celebratory cascade only plays for a live win.
  animate: boolean
  gameName: string // "Splashdle" | "Chroma Vision" - used in the countdown
}) {
  const posthog = usePostHog()
  const [countdown, setCountdown] = useState(nextPuzzleCountdown)

  useEffect(() => {
    const t = setInterval(() => setCountdown(nextPuzzleCountdown()), 30_000)
    return () => clearInterval(t)
  }, [])

  const share = async () => {
    if (!shareText) return
    try {
      await navigator.clipboard.writeText(shareText)
      toast('Result copied. Go flex it!')
      posthog.capture('game_result_shared', {
        game_name: gameName,
        outcome: status,
        guesses_used: guesses.length,
        max_guesses: maxGuesses,
        streak: streak.current,
      })
    } catch {
      toast("Couldn't copy to clipboard.", 'error')
    }
  }

  const won = status === 'won'

  return (
    <div className={`flex flex-col gap-5 ${animate ? 'stagger' : ''}`}>
      <div>
        <p className="mb-1 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          {won ? `Solved in ${guesses.length}/${maxGuesses}` : 'Out of guesses'}
        </p>
        <h2 className="font-serif text-3xl md:text-4xl font-bold text-gold1">
          <Link
            to="/skins/$slug"
            params={{ slug: skinSlug(answer.name, answer.skinId) }}
            className="transition duration-150 hover:text-gold2"
            title="View this skin's page"
          >
            {answer.name}
          </Link>
        </h2>
        <p className="text-grey1">{answer.championName}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <GuessSlots guesses={guesses} maxGuesses={maxGuesses} />
        {streak.current > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1 text-sm font-bold text-gold2 outline outline-icon/30 -outline-offset-1">
            <FontAwesomeIcon icon={faFire} className="h-3.5" />
            {streak.current}-day streak
          </span>
        )}
        {streak.best > 1 && (
          <span className="text-sm text-grey1">Best: {streak.best}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={share} className={`group ${btnPrimarySm}`}>
          <FontAwesomeIcon icon={faShareNodes} className="h-4" />
          Share result
        </button>
        <Link to="/battle" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faArrowLeft} className="h-4" />
          Back to the battle
        </Link>
        {/* Time-derived, so the server-rendered text can lag the client's
            by a minute - not worth a hydration warning. */}
        <span className="text-sm text-grey1" suppressHydrationWarning>
          Next {gameName} in {countdown}
        </span>
      </div>
    </div>
  )
}
