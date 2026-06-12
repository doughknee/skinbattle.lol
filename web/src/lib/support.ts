// The support link. A free site runs on goodwill, so the ask stays tiny:
// one quiet footer link, plus a single toast at the 50th battle vote that
// never repeats once it has been shown.

export const SUPPORT_URL = 'https://buymeacoffee.com/doughknee'

const COUNT_KEY = 'sb:battles-cast'
const OFFERED_KEY = 'sb:honeyfruit-offered'
const OFFER_AT = 50

// Count one battle vote. Returns true exactly once ever - when the lifetime
// counter crosses the threshold and the offer hasn't been shown before.
export function countBattleAndMaybeOffer(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const count = (Number(localStorage.getItem(COUNT_KEY)) || 0) + 1
    localStorage.setItem(COUNT_KEY, String(count))
    if (count < OFFER_AT || localStorage.getItem(OFFERED_KEY)) return false
    localStorage.setItem(OFFERED_KEY, '1')
    return true
  } catch {
    return false // storage unavailable: never nag, never crash the vote loop
  }
}
