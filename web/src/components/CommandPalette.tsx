import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faUser, faShirt } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { Spinner } from '~/components/Skeletons'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import type { Champion } from '~/lib/types'

const OPEN_EVENT = 'sb:open-search'

export function openCommandPalette() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

interface Entry {
  key: string
  kind: 'champion' | 'skin'
  label: string
  sub: string
  championId: string
  haystack: string
}

// Champions (with their skin lists) are fetched once per session and reused
// across palette opens.
let catalogPromise: Promise<Champion[]> | null = null
function loadCatalog(): Promise<Champion[]> {
  if (!catalogPromise) {
    catalogPromise = api.champions().catch((err) => {
      catalogPromise = null
      throw err
    })
  }
  return catalogPromise
}

const MAX_CHAMPIONS = 6
const MAX_SKINS = 10

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()

  // Open via Ctrl/Cmd+K or the navbar search button.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  // Build the searchable index on first open.
  useEffect(() => {
    if (!open || entries.length > 0) return
    let cancelled = false
    loadCatalog()
      .then((champions) => {
        if (cancelled) return
        const built: Entry[] = []
        for (const c of champions) {
          const name = championDisplayName(c.id)
          built.push({
            key: `c-${c.id}`,
            kind: 'champion',
            label: name,
            sub: c.title,
            championId: c.id,
            haystack: `${name} ${c.id} ${c.title}`.toLowerCase(),
          })
        }
        for (const c of champions) {
          const champName = championDisplayName(c.id)
          for (const s of c.skins ?? []) {
            const name = displaySkinName(s.name, c.id)
            built.push({
              key: `s-${s.id}`,
              kind: 'skin',
              label: name,
              sub: champName,
              championId: c.id,
              haystack: `${name} ${champName}`.toLowerCase(),
            })
          }
        }
        setEntries(built)
      })
      .catch(() => {
        /* palette just shows no results if the catalog fails to load */
      })
    return () => {
      cancelled = true
    }
  }, [open, entries.length])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // Focus after the panel renders.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const champions: Entry[] = []
    const skins: Entry[] = []
    for (const e of entries) {
      if (q && !e.haystack.includes(q)) continue
      if (e.kind === 'champion') {
        if (champions.length < MAX_CHAMPIONS) champions.push(e)
      } else if (q) {
        // Skins only show up once the user starts typing.
        if (skins.length < MAX_SKINS) skins.push(e)
      }
      if (champions.length >= MAX_CHAMPIONS && skins.length >= MAX_SKINS) break
    }
    return [...champions, ...skins]
  }, [entries, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const select = useCallback(
    (entry: Entry) => {
      setOpen(false)
      navigate({
        to: '/champions/$id',
        params: { id: entry.championId.toLowerCase() },
      })
    },
    [navigate],
  )

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[activeIndex]) select(results[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Keep the active row in view while arrowing through results.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const firstSkinIndex = results.findIndex((r) => r.kind === 'skin')

  return (
    <div
      className="animate-fade-in [animation-duration:200ms] fixed inset-0 z-[90] bg-hextech-black/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search champions and skins"
        className="animate-pop mx-auto mt-[12vh] w-full max-w-xl px-4"
      >
        <div className="bg-hextech-black/95 shadow-2xl outline outline-gold2/40 -outline-offset-1">
          <div className="flex items-center gap-3 border-b border-icon/20 px-4">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="h-4 text-gold2"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search champions and skins…"
              aria-label="Search champions and skins"
              className="h-12 w-full bg-transparent text-gold1 placeholder-grey1 outline-none"
            />
            <kbd className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold text-grey1 outline outline-icon/30">
              ESC
            </kbd>
          </div>

          <ul
            ref={listRef}
            role="listbox"
            className="max-h-[50vh] overflow-y-auto py-2"
          >
            {entries.length === 0 ? (
              <li
                role="status"
                className="flex items-center justify-center gap-2.5 px-4 py-6 text-sm text-grey1"
              >
                <Spinner className="h-4 w-4" />
                Loading the roster…
              </li>
            ) : results.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-grey1">
                No champions or skins match “{query}”.
              </li>
            ) : (
              results.map((entry, i) => (
                <li key={entry.key} data-index={i}>
                  {i === firstSkinIndex && (
                    <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-widest text-gold2/70">
                      Skins
                    </p>
                  )}
                  {i === 0 && entry.kind === 'champion' && (
                    <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-widest text-gold2/70">
                      Champions
                    </p>
                  )}
                  <button
                    role="option"
                    aria-selected={i === activeIndex}
                    onClick={() => select(entry)}
                    onMouseMove={() => setActiveIndex(i)}
                    className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left ${
                      i === activeIndex
                        ? 'bg-gold5/25 text-gold1'
                        : 'text-grey1'
                    }`}
                  >
                    <FontAwesomeIcon
                      icon={entry.kind === 'champion' ? faUser : faShirt}
                      className="h-3.5 shrink-0 text-gold2/80"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {entry.label}
                    </span>
                    <span className="shrink-0 truncate text-xs italic text-grey1">
                      {entry.sub}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <p className="mt-2 text-center text-xs text-grey1/80">
          ↑↓ to navigate · Enter to open · Esc to close
        </p>
      </div>
    </div>
  )
}
