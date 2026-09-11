// The bug this exists to prevent, found live on 2026-09-11: the skin dossier
// rendered "1,944 of 1,941 rated" - more ranked skins than skins.
//
// A rating row outlives the skin it describes. A Community Dragon sync can
// renumber or drop a catalog entry, and skin_ratings keeps the row: an orphan
// nobody can open a page for. globalRank() and ratedCount() counted
// skin_ratings directly, so those orphans inflated the denominator on every
// "#N of M" the site prints - the dossier, the Mirror, the home page, the
// share cards, the post-vote rank delta - and sat ahead of real skins in the
// rank. The ranking slices never had the bug, because they start from the
// catalog and join ratings onto it.
//
// The fix is one join in the two functions every caller routes through, so
// this tests those two directly against a catalog that has drifted.

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { globalRank, ratedCount } from './ratings'

function db(): DatabaseSync {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE catalog_skins (id TEXT PRIMARY KEY, champion_id TEXT NOT NULL,
    champion_name TEXT NOT NULL, num INTEGER NOT NULL, name TEXT NOT NULL,
    splash_url TEXT NOT NULL, tile_url TEXT, loadscreen_url TEXT,
    uncentered_splash_url TEXT);
   CREATE TABLE skin_ratings (skin_id TEXT PRIMARY KEY, rating REAL NOT NULL,
    uncertainty REAL NOT NULL, battles INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    last_battle_at TEXT);`)
  return d
}

const skin = (d: DatabaseSync, id: string, num: number) =>
  d
    .prepare(
      'INSERT INTO catalog_skins (id, champion_id, champion_name, num, name, splash_url) VALUES (?,?,?,?,?,?)',
    )
    .run(id, 'Lux', 'Lux', num, `Lux ${num}`, 'http://x/s.jpg')

const rating = (d: DatabaseSync, id: string, r: number, battles = 5) =>
  d
    .prepare(
      'INSERT INTO skin_ratings (skin_id, rating, uncertainty, battles, wins, updated_at) VALUES (?,?,?,?,?,?)',
    )
    .run(id, r, 80, battles, 2, '2026-09-11T00:00:00.000Z')

describe('the rated denominator', () => {
  it('counts only skins the catalog still has', () => {
    const d = db()
    skin(d, 'a', 1)
    skin(d, 'b', 2)
    rating(d, 'a', 1600)
    rating(d, 'b', 1500)
    // The orphan: rated, but dropped from the catalog by a sync. There is no
    // page for it, so it must not be in the denominator of "#N of M".
    rating(d, 'gone', 1700)
    expect(ratedCount(d)).toBe(2)
  })

  it('excludes the base look, the way every other surface does', () => {
    const d = db()
    skin(d, 'a', 1)
    skin(d, 'base', 0)
    rating(d, 'a', 1600)
    rating(d, 'base', 1900)
    expect(ratedCount(d)).toBe(1)
  })

  it('ignores skins that have never fought', () => {
    const d = db()
    skin(d, 'a', 1)
    skin(d, 'b', 2)
    rating(d, 'a', 1600)
    rating(d, 'b', 1500, 0)
    expect(ratedCount(d)).toBe(1)
  })
})

describe('globalRank', () => {
  it('does not seat an orphan or a base look ahead of a real skin', () => {
    const d = db()
    skin(d, 'a', 1)
    skin(d, 'b', 2)
    rating(d, 'a', 1600)
    rating(d, 'b', 1500)
    rating(d, 'gone', 1900) // orphan, rated higher
    rating(d, 'base', 1800) // base look, rated higher
    skin(d, 'base', 0)
    expect(globalRank(d, 1600)).toBe(1)
    expect(globalRank(d, 1500)).toBe(2)
  })

  it('never exceeds the denominator it is printed against', () => {
    // "#N of M" is only meaningful if both sides count the same set. This is
    // the invariant the live page broke.
    const d = db()
    for (const [i, r] of [1700, 1600, 1500, 1400].entries()) {
      skin(d, `s${i}`, i + 1)
      rating(d, `s${i}`, r)
    }
    rating(d, 'gone', 1800)
    const total = ratedCount(d)
    for (const r of [1700, 1600, 1500, 1400]) {
      expect(globalRank(d, r)).toBeLessThanOrEqual(total)
      expect(globalRank(d, r)).toBeGreaterThanOrEqual(1)
    }
    expect(globalRank(d, 1400)).toBe(total)
  })
})
