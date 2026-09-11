// A scoped session (/battle?champion=<id>) deals from one wardrobe with the
// SAME pickers the catalog-wide deal uses. These guard the two pure pieces:
// the pool restriction, and the within-wardrobe standing the feedback prints.

import { describe, expect, it } from 'vitest'
import { scopePool, scopedStanding, type RatedSkin } from './quickbattle'

const skin = (
  id: string,
  championId: string,
  rating: number,
  battles = 5,
): RatedSkin => ({
  id,
  championId,
  championName: championId,
  name: `${championId} ${id}`,
  splashUrl: 'http://x/s.jpg',
  rating,
  uncertainty: 90,
  battles,
})

const catalog = [
  skin('1', 'Ahri', 1600),
  skin('2', 'Ahri', 1500),
  skin('3', 'Ahri', 1550, 0), // never fought
  skin('4', 'MissFortune', 1700),
  skin('5', 'Lux', 1400),
]

describe('scopePool', () => {
  it('keeps only the wardrobe, matched case-insensitively (the URL is lowercase, the catalog is not)', () => {
    expect(scopePool(catalog, 'missfortune').map((s) => s.id)).toEqual(['4'])
    expect(scopePool(catalog, 'AHRI').map((s) => s.id)).toEqual(['1', '2', '3'])
    expect(scopePool(catalog, 'miss-fortune')).toEqual([])
  })
})

describe('scopedStanding', () => {
  it('ranks the winner among rated wardrobe members only, with named neighbours', () => {
    expect(scopedStanding(scopePool(catalog, 'ahri'), '2')).toEqual({
      rank: 2,
      of: 2,
      above: { name: 'Ahri 1', rank: 1 },
      below: null,
    })
  })

  it('has no neighbour above the leader, and nothing to say about an unrated skin', () => {
    const pool = scopePool(catalog, 'ahri')
    expect(scopedStanding(pool, '1')).toMatchObject({ rank: 1, above: null, below: { name: 'Ahri 2', rank: 2 } })
    expect(scopedStanding(pool, '3')).toBeNull()
    expect(scopedStanding(pool, 'nope')).toBeNull()
  })
})
