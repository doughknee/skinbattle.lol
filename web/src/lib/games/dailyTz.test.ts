import { describe, expect, it } from 'vitest'
import { msToNextReset, puzzleDay } from './dailyTz'

const H = 3_600_000

describe('puzzleDay', () => {
  it('returns the Chicago calendar date, not UTC', () => {
    // 03:00 UTC on Jun 16 is still 22:00 Jun 15 in Chicago (CDT, UTC-5).
    expect(puzzleDay(new Date('2026-06-16T03:00:00Z'))).toBe('2026-06-15')
    // After Chicago midnight (05:00 UTC in summer) it rolls over.
    expect(puzzleDay(new Date('2026-06-16T05:00:00Z'))).toBe('2026-06-16')
  })

  it('uses the -6h offset in winter (CST)', () => {
    expect(puzzleDay(new Date('2026-01-16T05:59:00Z'))).toBe('2026-01-15')
    expect(puzzleDay(new Date('2026-01-16T06:00:00Z'))).toBe('2026-01-16')
  })
})

describe('msToNextReset', () => {
  it('counts to the next Chicago midnight in summer (05:00 UTC)', () => {
    const noonCdt = Date.parse('2026-06-15T17:00:00Z') // 12:00 CDT
    expect(msToNextReset(noonCdt)).toBe(12 * H)
  })

  it('counts to the next Chicago midnight in winter (06:00 UTC)', () => {
    const noonCst = Date.parse('2026-01-15T18:00:00Z') // 12:00 CST
    expect(msToNextReset(noonCst)).toBe(12 * H)
  })

  it('resets to a full day exactly at the boundary', () => {
    expect(msToNextReset(Date.parse('2026-06-16T05:00:00Z'))).toBe(24 * H)
  })

  it('handles the 23h spring-forward day', () => {
    // Start of the DST-transition day, just after midnight CST.
    const startOfDay = Date.parse('2026-03-08T06:00:00Z')
    expect(msToNextReset(startOfDay)).toBe(23 * H)
  })

  it('handles the 25h fall-back day', () => {
    // Start of the fall-back day, just after midnight CDT.
    const startOfDay = Date.parse('2026-11-01T05:00:00Z')
    expect(msToNextReset(startOfDay)).toBe(25 * H)
  })
})
