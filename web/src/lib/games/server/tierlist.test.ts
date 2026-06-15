import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  boardHash,
  isStale,
  quintileTiers,
  resolveBoard,
  sanitizeTiers,
} from './tierlist'

function catalogDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE catalog_skins (id TEXT PRIMARY KEY, champion_id TEXT NOT NULL,
    champion_name TEXT NOT NULL, num INTEGER NOT NULL, name TEXT NOT NULL,
    splash_url TEXT NOT NULL, tile_url TEXT, loadscreen_url TEXT, uncentered_splash_url TEXT);`)
  return db
}
const addSkin = (db: DatabaseSync, id: string, champ: string, num: number) =>
  db
    .prepare(
      'INSERT INTO catalog_skins (id, champion_id, champion_name, num, name, splash_url) VALUES (?,?,?,?,?,?)',
    )
    .run(id, champ, champ, num, `${champ} ${num}`, 'http://x/splash.jpg')

describe('boardHash', () => {
  it('is order-independent and set-sensitive', () => {
    expect(boardHash(['a', 'b', 'c'])).toBe(boardHash(['c', 'a', 'b']))
    expect(boardHash(['a', 'b', 'c'])).not.toBe(boardHash(['a', 'b', 'd']))
    expect(boardHash(['a', 'b'])).not.toBe(boardHash(['a', 'b', 'c'])) // new skin added
  })
})

describe('sanitizeTiers', () => {
  const dealt = new Set(['a', 'b', 'c', 'd'])
  it('orders S→D, keeps only dealt skins, dedups across tiers', () => {
    const out = sanitizeTiers({ S: ['a', 'x'], B: ['c', 'a'], D: ['d'] }, dealt)
    expect(out).toEqual([['a'], [], ['c'], [], ['d']]) // x not dealt; a kept in S, deduped from B
  })
  it('handles an empty board', () => {
    expect(sanitizeTiers({}, dealt)).toEqual([[], [], [], [], []])
  })
})

describe('quintileTiers', () => {
  it('splits a rating-desc list into S→D fifths', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`)
    const t = quintileTiers(ids)
    expect([t.get('s0'), t.get('s1')]).toEqual(['S', 'S'])
    expect(t.get('s4')).toBe('B') // middle
    expect([t.get('s8'), t.get('s9')]).toEqual(['D', 'D'])
  })
})

describe('resolveBoard', () => {
  it('resolves a champion to its eligible (non-base) skins', () => {
    const db = catalogDb()
    addSkin(db, '99000', 'Lux', 0) // base — excluded
    for (let i = 1; i <= 6; i++) addSkin(db, `9900${i}`, 'Lux', i)
    addSkin(db, '1001', 'Annie', 1)
    const scope = resolveBoard(db, 'champion:Lux')
    expect(scope).not.toBeNull()
    expect(scope!.skins.length).toBe(6)
    expect(scope!.title).toContain('Lux')
    expect(scope!.skins.every((s) => s.championId === 'Lux')).toBe(true)
  })

  it('returns null for too-thin, unknown, and unsupported scopes', () => {
    const db = catalogDb()
    for (let i = 1; i <= 3; i++) addSkin(db, `100${i}`, 'Annie', i) // only 3 < MIN_BOARD
    expect(resolveBoard(db, 'champion:Annie')).toBeNull()
    expect(resolveBoard(db, 'champion:Nobody')).toBeNull()
    expect(resolveBoard(db, 'line:star-guardian')).toBeNull() // not in MVP
  })
})

describe('isStale (re-serve gating)', () => {
  const now = Date.parse('2026-06-15T00:00:00Z')
  it('a board the user never did is not "stale" (just available)', () => {
    expect(isStale(undefined, 'h', now)).toBe(false)
  })
  it('is stale when the board contents changed', () => {
    expect(isStale({ hash: 'old', at: '2026-06-14T00:00:00Z' }, 'new', now)).toBe(true)
  })
  it('is fresh within the cooldown, stale after it', () => {
    expect(isStale({ hash: 'h', at: '2026-06-14T00:00:00Z' }, 'h', now)).toBe(false)
    expect(isStale({ hash: 'h', at: '2026-04-01T00:00:00Z' }, 'h', now)).toBe(true)
  })
})
