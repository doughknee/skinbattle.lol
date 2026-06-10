// Tiny shared store for the user's star/ban quota so the navbar chip and
// skin cards stay in sync without prop drilling. The QuotaChip owns the
// authoritative refetch (on auth change + 'updateUserStats' events); skin
// cards apply optimistic adjustments for instant toast feedback.

export interface QuotaStats {
  usedStars: number
  usedX: number
}

export const MAX_STARS = 3
export const MAX_X = 3

let stats: QuotaStats = { usedStars: 0, usedX: 0 }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export const userStatsStore = {
  get(): QuotaStats {
    return stats
  },
  set(next: QuotaStats) {
    stats = next
    emit()
  },
  adjust(delta: { stars?: number; x?: number }) {
    stats = {
      usedStars: Math.max(0, stats.usedStars + (delta.stars ?? 0)),
      usedX: Math.max(0, stats.usedX + (delta.x ?? 0)),
    }
    emit()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
