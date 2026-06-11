// Tiny shared store for the user's star/ban quota so the navbar chip and
// skin cards stay in sync without prop drilling. The QuotaChip owns the
// authoritative refetch (on auth change + 'updateUserStats' events); skin
// cards apply optimistic adjustments for instant toast feedback.
//
// The last-known stats persist to localStorage so the chip renders real
// numbers immediately on page load instead of waiting for /user/stats.

export interface QuotaStats {
  usedStars: number
  usedX: number
}

export const MAX_STARS = 3
export const MAX_X = 3

const STORAGE_KEY = 'sb:quota'

function readPersisted(): QuotaStats | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.usedStars === 'number' &&
      typeof parsed?.usedX === 'number'
    ) {
      return { usedStars: parsed.usedStars, usedX: parsed.usedX }
    }
  } catch {
    /* corrupted entry — fall through to defaults */
  }
  return null
}

let stats: QuotaStats = readPersisted() ?? { usedStars: 0, usedX: 0 }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    /* storage full/unavailable — stay in-memory only */
  }
}

export const userStatsStore = {
  get(): QuotaStats {
    return stats
  },
  set(next: QuotaStats) {
    stats = next
    persist()
    emit()
  },
  adjust(delta: { stars?: number; x?: number }) {
    stats = {
      usedStars: Math.max(0, stats.usedStars + (delta.stars ?? 0)),
      usedX: Math.max(0, stats.usedX + (delta.x ?? 0)),
    }
    persist()
    emit()
  },
  // Signed out: zero the stats and drop the persisted copy (its presence
  // doubles as the "user was signed in here before" hint).
  clear() {
    stats = { usedStars: 0, usedX: 0 }
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
    }
    emit()
  },
  hasPersisted(): boolean {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(STORAGE_KEY) !== null
    } catch {
      return false
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
