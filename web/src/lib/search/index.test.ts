import { describe, it, expect } from 'vitest'
import { createSearcher, norm, wordsOf } from './index'

interface Skin {
  name: string
  champion: string
}

const skins: Skin[] = [
  { name: "K/DA Akali", champion: 'Akali' },
  { name: 'PROJECT: Yi', champion: 'Master Yi' },
  { name: 'Bullet Angel Kai’Sa', champion: 'Kai’Sa' },
  { name: 'Star Guardian Ahri', champion: 'Ahri' },
  { name: 'Spirit Blossom Ahri', champion: 'Ahri' },
  { name: 'Elderwood Ahri', champion: 'Ahri' },
  { name: 'Dragon Trainer Heimerdinger', champion: 'Heimerdinger' },
  { name: 'Pulsefire Ezreal', champion: 'Ezreal' },
]

const make = (prefixFirst = false, limit?: number) =>
  createSearcher(skins, {
    keys: [{ name: 'name', weight: 0.7 }, { name: 'champion', weight: 0.3 }],
    prefixFirst,
    limit,
    minLength: prefixFirst ? 2 : 1,
  })

const names = (rows: Skin[]) => rows.map((r) => r.name)

describe('normalization helpers', () => {
  it('folds accents and punctuation', () => {
    expect(norm("Kai’Sa")).toBe('kai sa')
    expect(norm('K/DA')).toBe('k da')
    expect(norm('PROJECT: Yi')).toBe('project yi')
  })

  it('indexes words both split and collapsed', () => {
    expect(wordsOf("Kai’Sa")).toEqual(expect.arrayContaining(['kaisa', 'kai', 'sa']))
    expect(wordsOf('K/DA')).toEqual(expect.arrayContaining(['kda', 'k', 'da']))
  })
})

describe('punctuation-insensitive matching', () => {
  const s = make()
  it('finds K/DA from "kda"', () => {
    expect(names(s.search('kda'))).toContain("K/DA Akali")
  })
  it('finds Kai’Sa from "kaisa"', () => {
    expect(names(s.search('kaisa'))).toContain('Bullet Angel Kai’Sa')
  })
  it('finds PROJECT: Yi from "project yi"', () => {
    expect(names(s.search('project yi'))).toContain('PROJECT: Yi')
  })
  it('matches across accented champion field', () => {
    expect(names(s.search('kai sa'))).toContain('Bullet Angel Kai’Sa')
  })
})

describe('prefix-first autocomplete', () => {
  const s = make(true, 8)
  it('ranks a full name-prefix above mere word matches', () => {
    const out = names(s.search('star'))
    expect(out[0]).toBe('Star Guardian Ahri')
  })
  it('respects the result cap', () => {
    const wide = createSearcher(
      Array.from({ length: 30 }, (_, i) => ({ name: `Ahri Variant ${i}`, champion: 'Ahri' })),
      { keys: ['name', 'champion'], prefixFirst: true, limit: 8, minLength: 2 },
    )
    expect(wide.search('ahri').length).toBe(8)
  })
  it('returns nothing below minLength', () => {
    expect(s.search('a')).toEqual([])
  })
  it('returns nothing on empty query (autocomplete)', () => {
    expect(s.search('')).toEqual([])
  })
})

describe('fuzzy tolerance', () => {
  it('recovers from a one-character typo (default mode)', () => {
    const s = make()
    expect(names(s.search('pulsfire'))).toContain('Pulsefire Ezreal')
  })
  it('autocomplete falls back to fuzzy only when nothing exact matches', () => {
    const s = make(true, 8)
    expect(names(s.search('pulsfire'))).toContain('Pulsefire Ezreal')
  })
  it('returns empty for junk', () => {
    const s = make()
    expect(s.search('zzqq')).toEqual([])
  })
})

describe('default filter mode', () => {
  const s = make()
  it('returns all items on empty query', () => {
    expect(s.search('').length).toBe(skins.length)
  })
  it('matches a mid-word substring the old .includes() would have', () => {
    // "ngel" is inside "Angel" - not a word prefix, but a substring.
    expect(names(s.search('ngel'))).toContain('Bullet Angel Kai’Sa')
  })
  it('finds every Ahri skin by champion', () => {
    expect(s.search('ahri').length).toBe(3)
  })
})
