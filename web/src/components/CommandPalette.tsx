import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faUser, faShirt } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { api } from '~/lib/api'
import { Spinner } from '~/components/Skeletons'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import { allSitePages, quickNavPages } from '~/lib/siteMap'
import type { Champion } from '~/lib/types'

const OPEN_EVENT = 'sb:open-search'

export function openCommandPalette() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

type Entry = {
  key: string
  label: string
  sub: string
  haystack: string
} & (
  | { kind: 'page'; to: string; icon: IconDefinition }
  | { kind: 'champion' | 'skin'; championId: string }
)

// Every navigable page, from the site-map registry. Static — built once.
const pageEntries: Entry[] = allSitePages().map((p) => ({
  key: `p-${p.to}`,
  kind: 'page',
  label: p.label,
  sub: p.blurb,
  to: p.to,
  icon: p.icon,
  haystack: `${p.label} ${p.to} ${p.search ?? ''}`.toLowerCase(),
}))
const quickNavKeys = new Set(quickNavPages().map((p) => `p-${p.to}`))

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

const MAX_PAGES = 5
const MAX_CHAMPIONS = 6
const MAX_SKINS = 10

const GROUP_LABELS: Record<Entry['kind'], string> = {
  page: 'Pages',
  champion: 'Champions',
  skin: 'Skins',
}

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

  // Build the searchable champion/skin index on first open.
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
        /* pages still work if the catalog fails to load */
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
    if (!q) {
      // Before typing: the main sections, then the champion roster.
      const quick = pageEntries.filter((p) => quickNavKeys.has(p.key))
      const champions = entries
        .filter((e) => e.kind === 'champion')
        .slice(0, MAX_CHAMPIONS)
      return [...quick, ...champions]
    }
    const pages: Entry[] = []
    for (const p of pageEntries) {
      if (p.haystack.includes(q)) {
        pages.push(p)
        if (pages.length >= MAX_PAGES) break
      }
    }
    const champions: Entry[] = []
    const skins: Entry[] = []
    for (const e of entries) {
      if (!e.haystack.includes(q)) continue
      if (e.kind === 'champion') {
        if (champions.length < MAX_CHAMPIONS) champions.push(e)
      } else if (skins.length < MAX_SKINS) {
        skins.push(e)
      }
      if (champions.length >= MAX_CHAMPIONS && skins.length >= MAX_SKINS) break
    }
    return [...pages, ...champions, ...skins]
  }, [entries, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const select = useCallback(
    (entry: Entry) => {
      setOpen(false)
      if (entry.kind === 'page') {
        navigate({ to: entry.to })
      } else {
        navigate({
          to: '/champions/$id',
          params: { id: entry.championId.toLowerCase() },
        })
      }
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

  const loadingCatalog = entries.length === 0

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
        aria-label="Search pages, champions, and skins"
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
              placeholder="Search pages, champions, and skins…"
              aria-label="Search pages, champions, and skins"
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
            {results.length === 0 ? (
              loadingCatalog ? (
                <li
                  role="status"
                  className="flex items-center justify-center gap-2.5 px-4 py-6 text-sm text-grey1"
                >
                  <Spinner className="h-4 w-4" />
                  Loading the roster…
                </li>
              ) : (
                <li className="px-4 py-6 text-center text-sm text-grey1">
                  Nothing matches “{query}”.
                </li>
              )
            ) : (
              results.map((entry, i) => (
                <li key={entry.key} data-index={i}>
                  {(i === 0 || results[i - 1].kind !== entry.kind) && (
                    <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-widest text-gold2/70">
                      {GROUP_LABELS[entry.kind]}
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
                      icon={
                        entry.kind === 'page'
                          ? entry.icon
                          : entry.kind === 'champion'
                            ? faUser
                            : faShirt
                      }
                      className="h-3.5 w-4 shrink-0 text-gold2/80"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {entry.label}
                    </span>
                    <span className="shrink-0 max-w-[45%] truncate text-xs italic text-grey1">
                      {entry.sub}
                    </span>
                  </button>
                </li>
              ))
            )}
            {loadingCatalog && results.length > 0 && (
              <li
                role="status"
                className="flex items-center gap-2.5 px-4 py-3 text-xs text-grey1"
              >
                <Spinner className="h-3.5 w-3.5" />
                Loading champions and skins…
              </li>
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
