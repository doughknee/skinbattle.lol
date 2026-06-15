import { describe, expect, it } from 'vitest'
import {
  inflateUncertainty,
  MIN_UNCERTAINTY,
  START_UNCERTAINTY,
} from './ratings'
import {
  coverageDeficit,
  dealMix,
  type RatedSkin,
} from './quickbattle'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-01-01T00:00:00.000Z')

describe('inflateUncertainty (Glicko time-decay of confidence)', () => {
  it('never-fought skins stay at full uncertainty', () => {
    expect(inflateUncertainty(START_UNCERTAINTY, null, T0)).toBe(START_UNCERTAINTY)
  })

  it('a just-battled skin is unchanged', () => {
    const at = new Date(T0).toISOString()
    expect(inflateUncertainty(MIN_UNCERTAINTY, at, T0)).toBe(MIN_UNCERTAINTY)
  })

  it('widens monotonically as a settled skin sits idle', () => {
    const at = new Date(T0).toISOString()
    const d7 = inflateUncertainty(MIN_UNCERTAINTY, at, T0 + 7 * DAY)
    const d30 = inflateUncertainty(MIN_UNCERTAINTY, at, T0 + 30 * DAY)
    const d90 = inflateUncertainty(MIN_UNCERTAINTY, at, T0 + 90 * DAY)
    expect(d7).toBeGreaterThan(MIN_UNCERTAINTY)
    expect(d30).toBeGreaterThan(d7)
    expect(d90).toBeGreaterThan(d30)
    // A week barely moves it; three months is a real re-widening.
    expect(d7).toBeLessThan(100)
    expect(d90).toBeGreaterThan(200)
  })

  it('returns a settled skin to the fresh band after the full idle period', () => {
    const at = new Date(T0).toISOString()
    const full = inflateUncertainty(MIN_UNCERTAINTY, at, T0 + 180 * DAY)
    expect(full).toBeCloseTo(START_UNCERTAINTY, 5)
  })

  it('never exceeds the fresh-skin ceiling', () => {
    const at = new Date(T0).toISOString()
    expect(inflateUncertainty(MIN_UNCERTAINTY, at, T0 + 10_000 * DAY)).toBe(
      START_UNCERTAINTY,
    )
  })

  it('ignores clock skew (future timestamps do not shrink it)', () => {
    const future = new Date(T0 + 5 * DAY).toISOString()
    expect(inflateUncertainty(120, future, T0)).toBe(120)
  })
})

function skin(battles: number): RatedSkin {
  return {
    id: 's' + battles + Math.random(),
    championId: 'X',
    championName: 'X',
    name: 'X',
    splashUrl: '',
    rating: 1500,
    uncertainty: 350,
    battles,
  }
}

const FLOOR = 10 // PLACEMENT_BATTLES

describe('coverageDeficit', () => {
  it('is 1.0 when nothing has fought', () => {
    expect(coverageDeficit(Array.from({ length: 50 }, () => skin(0)))).toBe(1)
  })
  it('is 0.0 when every skin is floored', () => {
    expect(coverageDeficit(Array.from({ length: 50 }, () => skin(FLOOR)))).toBe(0)
  })
  it('caps each skin at the floor (over-fed skins do not create surplus)', () => {
    // One skin with 1000 battles cannot mask 9 unrated ones.
    const pool = [skin(1000), ...Array.from({ length: 9 }, () => skin(0))]
    expect(coverageDeficit(pool)).toBeCloseTo(0.9, 5)
  })
  it('reflects partial progress', () => {
    expect(coverageDeficit(Array.from({ length: 10 }, () => skin(5)))).toBeCloseTo(
      0.5,
      5,
    )
  })
})

describe('dealMix (coverage-driven allocation)', () => {
  const placementShare = (m: [string, number][]) => m[0][1]

  it('floods placement when the catalog is wide open', () => {
    const m = dealMix(Array.from({ length: 100 }, () => skin(0)))
    expect(m[0][0]).toBe('placement')
    expect(placementShare(m)).toBe(0.8) // capped at MAX
  })

  it('drops placement to the maintenance floor once floored', () => {
    const m = dealMix(Array.from({ length: 100 }, () => skin(FLOOR)))
    expect(placementShare(m)).toBe(0.15) // MIN
  })

  it('ramps placement back up when new (zero-battle) skins appear', () => {
    const floored = Array.from({ length: 90 }, () => skin(FLOOR))
    const before = placementShare(dealMix(floored))
    const afterPatch = placementShare(
      dealMix([...floored, ...Array.from({ length: 60 }, () => skin(0))]),
    )
    expect(afterPatch).toBeGreaterThan(before)
  })

  it('produces a valid cumulative distribution ending at 1', () => {
    const m = dealMix(Array.from({ length: 100 }, () => skin(3)))
    const cuts = m.map(([, c]) => c)
    expect(cuts[cuts.length - 1]).toBeCloseTo(1, 9)
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]).toBeGreaterThan(cuts[i - 1])
    expect(m.map(([t]) => t)).toEqual([
      'placement',
      'informative',
      'dunk',
      'marquee',
    ])
  })
})
