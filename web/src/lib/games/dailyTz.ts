// The daily-puzzle clock. Every game's "today" and every reset countdown is
// anchored to midnight in this timezone. America/Chicago tracks daylight
// saving, so the reset stays at local midnight (US Central) year-round rather
// than drifting an hour with the seasons. Isomorphic: the Intl timeZone option
// is independent of the host clock, so server (puzzle selection) and browser
// (countdown) agree regardless of where they run.

export const PUZZLE_TZ = 'America/Chicago'

// YYYY-MM-DD via the en-CA locale (which renders ISO order); the timeZone
// option makes it DST-aware.
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: PUZZLE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// The current puzzle date (YYYY-MM-DD) in PUZZLE_TZ.
export function puzzleDay(now: Date = new Date()): string {
  return dayFmt.format(now)
}

// Milliseconds from `nowMs` until the next reset — the next midnight in
// PUZZLE_TZ. DST-correct: spring-forward days count 23h, fall-back days 25h,
// because the boundary is derived from the zone's actual offset, not a fixed
// 24h step.
export function msToNextReset(nowMs: number): number {
  // Tomorrow = today's date string + 1 calendar day. Parsing as UTC purely to
  // roll the Y-M-D is DST-safe; stepping the *instant* by 24h is not, because
  // on the 25h fall-back day now+24h is still the same local date.
  const today = puzzleDay(new Date(nowMs))
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10)
  return utcMsOfLocalMidnight(tomorrow) - nowMs
}

// All-numeric parts of an instant rendered in PUZZLE_TZ, used to read the
// zone's offset at that instant.
const offsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PUZZLE_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

// PUZZLE_TZ's offset from UTC (ms) at the given instant. Chicago is behind UTC,
// so this is negative (-6h CST / -5h CDT).
function tzOffsetMs(atMs: number): number {
  const parts = offsetFmt.formatToParts(new Date(atMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  let hour = get('hour')
  if (hour === 24) hour = 0 // some ICU builds report midnight as "24"
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  )
  return asUtc - atMs
}

// The UTC instant of local midnight (00:00 PUZZLE_TZ) on the given YYYY-MM-DD.
// Treat that wall-clock midnight as if it were UTC, then subtract the zone's
// offset to reach the real instant; re-read the offset at the result in case
// the first guess fell on the far side of a DST transition.
function utcMsOfLocalMidnight(date: string): number {
  const wall = Date.parse(`${date}T00:00:00Z`)
  const approx = wall - tzOffsetMs(wall)
  return wall - tzOffsetMs(approx)
}
