import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  applyTierListUpdate,
  getSkinRating,
  ratingEventCount,
  runRefit,
  START_RATING,
  TIER_SKIN_CAP,
  tierComparisons,
  tierDownweight,
} from './ratings'

// Minimal in-memory schema covering only the tables these functions touch.
function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE skin_ratings (skin_id TEXT PRIMARY KEY, rating REAL NOT NULL,
      uncertainty REAL NOT NULL, battles INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, last_battle_at TEXT);
    CREATE TABLE user_skin_ratings (user_id TEXT NOT NULL, skin_id TEXT NOT NULL,
      rating REAL NOT NULL, battles INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, skin_id));
    CREATE TABLE game_users (id TEXT PRIMARY KEY, logto_sub TEXT);
    CREATE TABLE game_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      game TEXT NOT NULL, puzzle_date TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
      question_asked TEXT NOT NULL, asset_version TEXT NOT NULL, trust_tier TEXT NOT NULL,
      created_at TEXT NOT NULL);
    CREATE TABLE catalog_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  return db
}

const event = (db: DatabaseSync, game: string, type: string, payload: object, ts: string) =>
  db
    .prepare(
      `INSERT INTO game_events (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
       VALUES ('u1', ?, '2026-06-15', ?, ?, 'q', 'x', 'member', ?)`,
    )
    .run(game, type, JSON.stringify(payload), ts)

describe('tierComparisons', () => {
  it('higher tiers beat lower tiers; same-tier pairs are ties', () => {
    const comps = tierComparisons([['a', 'b'], ['c'], ['d', 'e']])
    expect(comps.length).toBe(2 * 1 + 2 * 2 + 1 * 2) // 8
    expect(comps).toContainEqual({ winnerId: 'a', loserId: 'c' })
    expect(comps).toContainEqual({ winnerId: 'c', loserId: 'e' })
    // no within-tier comparison
    expect(comps.some((c) => c.winnerId === 'a' && c.loserId === 'b')).toBe(false)
    expect(comps.some((c) => c.winnerId === 'd' && c.loserId === 'e')).toBe(false)
    // never a lower tier beating a higher one
    expect(comps.some((c) => c.winnerId === 'c' && c.loserId === 'a')).toBe(false)
  })

  it('empty and single-tier boards yield nothing', () => {
    expect(tierComparisons([])).toEqual([])
    expect(tierComparisons([['a', 'b', 'c']])).toEqual([])
  })
})

describe('tierDownweight', () => {
  it('is full at/under the cap and scales down above it', () => {
    expect(tierDownweight(0)).toBe(0)
    expect(tierDownweight(4)).toBe(1)
    expect(tierDownweight(8)).toBe(1)
    expect(tierDownweight(16)).toBe(0.5)
    expect(tierDownweight(40)).toBeCloseTo(0.2, 9)
  })
})

describe('applyTierListUpdate', () => {
  it('a one-comparison board equals a single 1v1 (symmetric ±32)', () => {
    const db = makeDb()
    const res = applyTierListUpdate(db, 'u1', [['a'], ['b']], 1)
    const a = getSkinRating(db, 'a')
    const b = getSkinRating(db, 'b')
    expect(a.rating).toBeCloseTo(1532, 6) // K(±350)=64, dw(1)=1, (1−0.5)=.5 → +32
    expect(b.rating).toBeCloseTo(1468, 6)
    expect(a.rating - START_RATING).toBeCloseTo(START_RATING - b.rating, 6)
    expect(res.find((r) => r.skinId === 'a')!.delta).toBeCloseTo(32, 6)
  })

  it('battles counts one appearance per skin, not one per comparison', () => {
    const db = makeDb()
    applyTierListUpdate(db, 'u1', [['a'], ['c', 'd']], 1) // a is in 2 comparisons
    expect(getSkinRating(db, 'a').battles).toBe(1)
    expect(getSkinRating(db, 'c').battles).toBe(1)
    expect(getSkinRating(db, 'a').wins).toBe(0) // wins stays head-to-head only
    expect(getSkinRating(db, 'a').lastBattleAt).not.toBeNull()
  })

  it('down-weights large boards (16 comparisons → half per-comparison weight)', () => {
    const db = makeDb()
    // 4 vs 4 = 16 comparisons (dw=0.5); each top skin wins all 4 of its
    // comparisons vs fresh 1500s → actual 4, expected 2, K=64.
    applyTierListUpdate(db, 'u1', [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']], 1)
    // delta = 64 × (1×0.5) × (4 − 2) = 64; undiscounted it would be 128.
    expect(getSkinRating(db, 'a').rating).toBeCloseTo(1564, 4)
    expect(getSkinRating(db, 'e').rating).toBeCloseTo(1436, 4)
  })

  it('caps one skin\'s swing on a lopsided board (per-skin budget)', () => {
    const db = makeDb()
    const bottom = Array.from({ length: 14 }, (_, i) => `b${i}`)
    applyTierListUpdate(db, 'u1', [['top'], bottom], 1) // 1 over 14, member
    // Uncapped, the lone top skin would gain ~+256 from a single submission.
    // Capped at TIER_SKIN_CAP effective comparisons (fresh K=64, ½ expected each)
    // it gains exactly K_MAX × TIER_SKIN_CAP × 0.5 = 32 × CAP.
    expect(getSkinRating(db, 'top').rating - START_RATING).toBeCloseTo(32 * TIER_SKIN_CAP, 6)
    // A bottom skin is in just one comparison → under budget → unchanged.
    expect(getSkinRating(db, 'b0').rating).toBeLessThan(START_RATING)
  })

  it('updates the personal mirror too', () => {
    const db = makeDb()
    applyTierListUpdate(db, 'u1', [['a'], ['b']], 1)
    const read = (id: string) =>
      db
        .prepare('SELECT rating, battles FROM user_skin_ratings WHERE user_id=? AND skin_id=?')
        .get('u1', id) as { rating: number; battles: number }
    expect(read('a').rating).toBeGreaterThan(START_RATING)
    expect(read('b').rating).toBeLessThan(START_RATING)
    expect(read('a').battles).toBe(1)
  })
})

describe('runRefit ingests tier-list submissions', () => {
  it('rates a board top→bottom, one appearance per skin', () => {
    const db = makeDb()
    db.prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)').run('u1', 'sub1')
    event(db, 'tier-list', 'tier_submitted', { boardId: 'champion:Test', tiers: { S: ['a'], A: ['b'], B: ['c'] } }, '2026-06-15T00:00:00.000Z')
    const summary = runRefit(db)
    expect(summary.skins).toBe(3)
    const [a, b, c] = ['a', 'b', 'c'].map((id) => getSkinRating(db, id))
    expect(a.rating).toBeGreaterThan(b.rating)
    expect(b.rating).toBeGreaterThan(c.rating)
    expect([a.battles, b.battles, c.battles]).toEqual([1, 1, 1])
    expect(a.lastBattleAt).toBe('2026-06-15T00:00:00.000Z')
  })

  it('combines 1v1 and tier-list evidence for the same skins', () => {
    const db = makeDb()
    db.prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)').run('u1', 'sub1')
    event(db, 'quick-battle', 'battle_voted', { winnerId: 'a', loserId: 'b' }, '2026-06-15T00:00:00.000Z')
    event(db, 'tier-list', 'tier_submitted', { tiers: { S: ['a'], A: ['b'] } }, '2026-06-15T00:00:01.000Z')
    runRefit(db)
    const a = getSkinRating(db, 'a')
    expect(a.rating).toBeGreaterThan(getSkinRating(db, 'b').rating)
    expect(a.battles).toBe(2) // one 1v1 + one tier-list appearance
    expect(a.wins).toBe(1) // head-to-head win only; tier list doesn't bump wins
  })
})

describe('refit cadence counts both battle modes', () => {
  it('ratingEventCount sums quick-battle votes and tier-list submissions', () => {
    const db = makeDb()
    db.prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)').run('u1', 'sub1')
    expect(ratingEventCount(db)).toBe(0)
    event(db, 'quick-battle', 'battle_voted', { winnerId: 'a', loserId: 'b' }, '2026-06-15T00:00:00.000Z')
    event(db, 'tier-list', 'tier_submitted', { tiers: { S: ['a'], A: ['b'] } }, '2026-06-15T00:00:01.000Z')
    event(db, 'tier-list', 'tier_submitted', { tiers: { S: ['c'], A: ['d'] } }, '2026-06-15T00:00:02.000Z')
    expect(ratingEventCount(db)).toBe(3)
  })

  it('runRefit records the COMBINED event count as the cadence baseline', () => {
    // Regression guard: the baseline must match ratingEventCount, else a
    // tier-only stretch never makes `fresh` cross the threshold and never refits.
    const db = makeDb()
    db.prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)').run('u1', 'sub1')
    event(db, 'quick-battle', 'battle_voted', { winnerId: 'a', loserId: 'b' }, '2026-06-15T00:00:00.000Z')
    event(db, 'tier-list', 'tier_submitted', { tiers: { S: ['a'], A: ['b'] } }, '2026-06-15T00:00:01.000Z')
    const summary = runRefit(db)
    expect(summary.events).toBe(2)
    const meta = db
      .prepare("SELECT v FROM catalog_meta WHERE k = 'refit_events'")
      .get() as { v: string } | undefined
    expect(meta?.v).toBe(String(ratingEventCount(db)))
  })
})
