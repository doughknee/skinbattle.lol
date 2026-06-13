// Unified search for every list-filter and autocomplete on the site.
//
// One ranked matcher, used by the games guess box, the command palette, the
// champions catalog, the rankings pickers and the mirror filter. It pairs two
// things:
//   1. Domain-smart normalization lifted from the original Splashdle matcher -
//      accent-folding and dual punctuation indexing so "kaisa" finds Kai'Sa,
//      "kda" finds K/DA, "project yi" finds "PROJECT: Yi".
//   2. fuse.js for typo tolerance, but only ever AFTER the confident exact /
//      prefix / substring matches, so an obvious result never gets buried
//      beneath a fuzzy guess.
//
// Two modes via `prefixFirst`:
//   - prefixFirst (autocomplete): name-prefix then word-prefix matches; fuzzy
//     is a *fallback* used only when nothing exact matches. Keeps the guess
//     box's tight, predictable list.
//   - default (filters): name-prefix, word-prefix and substring matches first,
//     then fuzzy extras appended for typo tolerance.

import Fuse from 'fuse.js'

// ─── normalization (single-sourced; GuessKit re-exports these) ───────────────

// Lowercase and strip combining diacritics so "Bé" matches "be".
export const stripAccents = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

// Collapse everything that isn't a letter/number to a single space.
export const norm = (s: string): string =>
  stripAccents(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Each whitespace-delimited word is indexed both punctuation-split and
// punctuation-collapsed, so Kai'Sa answers to "kai sa" AND "kaisa", and K/DA
// to "k da" AND "kda".
export function wordsOf(s: string): string[] {
  const out = new Set<string>()
  for (const raw of stripAccents(s).split(/\s+/)) {
    const collapsed = raw.replace(/[^a-z0-9]+/g, '')
    if (collapsed) out.add(collapsed)
    for (const part of raw.split(/[^a-z0-9]+/)) if (part) out.add(part)
  }
  return [...out]
}

// ─── searcher ────────────────────────────────────────────────────────────────

export interface SearchKey<T> {
  name: keyof T & string
  weight?: number
}

export interface SearcherOptions<T> {
  // Fields to search. The FIRST key is the primary name used for prefix
  // ranking; all keys feed word/substring/fuzzy matching.
  keys: Array<(keyof T & string) | SearchKey<T>>
  // Cap the result count (undefined = return everything that matched).
  limit?: number
  // Autocomplete mode: exact/prefix only, fuzzy as a fallback. See header.
  prefixFirst?: boolean
  // Shortest query that returns results (default 1; the guess box uses 2).
  minLength?: number
}

export interface Searcher<T> {
  search(query: string): T[]
}

interface Indexed<T> {
  item: T
  nameNorm: string
  words: string[]
  haystack: string
}

function readField<T>(item: T, key: keyof T & string): string {
  const v = item[key]
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

// Build a reusable searcher over `items`. The fuse index and per-item
// normalization are computed once here - callers should memoize on the item
// list, not rebuild per keystroke.
export function createSearcher<T>(
  items: readonly T[],
  opts: SearcherOptions<T>,
): Searcher<T> {
  const keys = opts.keys.map((k) => (typeof k === 'string' ? { name: k } : k))
  const primary = keys[0].name
  const minLength = opts.minLength ?? 1
  const { limit, prefixFirst } = opts

  const indexed: Indexed<T>[] = items.map((item) => {
    const values = keys.map((k) => readField(item, k.name))
    return {
      item,
      nameNorm: norm(readField(item, primary)),
      words: wordsOf(values.join(' ')),
      haystack: norm(values.join(' ')),
    }
  })

  const fuse = new Fuse(indexed, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.3,
    minMatchCharLength: 2,
    keys: keys.map((k) => ({
      name: k.name,
      weight: k.weight ?? 1,
      // Search the normalized text so fuzzy matching agrees with our buckets.
      getFn: (entry: Indexed<T>) => norm(readField(entry.item, k.name)),
    })),
  })

  return {
    search(query: string): T[] {
      const q = norm(query)
      if (!q) {
        if (prefixFirst) return []
        return limit ? items.slice(0, limit) : [...items]
      }
      if (q.length < minLength) return []

      const tokens = q.split(' ')
      const starts: Indexed<T>[] = []
      const wordStarts: Indexed<T>[] = []
      const substr: Indexed<T>[] = []
      const picked = new Set<Indexed<T>>()
      for (const e of indexed) {
        if (e.nameNorm.startsWith(q)) {
          starts.push(e)
          picked.add(e)
        } else if (tokens.every((t) => e.words.some((w) => w.startsWith(t)))) {
          wordStarts.push(e)
          picked.add(e)
        } else if (!prefixFirst && e.haystack.includes(q)) {
          substr.push(e)
          picked.add(e)
        }
      }
      const exact = [...starts, ...wordStarts, ...substr]

      let result: Indexed<T>[]
      if (prefixFirst) {
        // Fuzzy only rescues a query that matched nothing exactly.
        result = exact.length ? exact : fuse.search(q).map((r) => r.item)
      } else {
        const fuzzy = fuse
          .search(q)
          .map((r) => r.item)
          .filter((e) => !picked.has(e))
        result = [...exact, ...fuzzy]
      }

      const out = result.map((e) => e.item)
      return limit ? out.slice(0, limit) : out
    },
  }
}
