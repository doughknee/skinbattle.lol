import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { getSkinRating, runRefit, skinVoters } from './ratings'

// Minimal in-memory schema covering only the tables runRefit touches.
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

// A member voter (logto_sub set → full weight, so the per-skin cap bites at ~6).
const member = (db: DatabaseSync, id: string) =>
  db
    .prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)')
    .run(id, 'sub-' + id)

const vote = (
  db: DatabaseSync,
  userId: string,
  winnerId: string,
  loserId: string,
  i: number,
) =>
  db
    .prepare(
      `INSERT INTO game_events (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
       VALUES (?, 'quick-battle', '2026-06-15', 'battle_voted', ?, 'q', 'x', 'member', ?)`,
    )
    .run(
      userId,
      JSON.stringify({ winnerId, loserId }),
      `2026-06-15T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(
        i % 60,
      ).padStart(2, '0')}:00.000Z`,
    )

describe('quick-battle refit: per-voter-per-skin influence cap', () => {
  const N = 30
  const challengers = Array.from({ length: N }, (_, i) => 'c' + i)

  it('counts every vote as a battle but flags a single-voter farm', () => {
    const db = makeDb()
    member(db, 'F')
    challengers.forEach((c, i) => vote(db, 'F', 'S', c, i)) // F parks on S, beats 30
    const summary = runRefit(db)
    const s = getSkinRating(db, 'S')

    // Volume is untouched: all 30 wins still logged as real battles.
    expect(s.battles).toBe(N)
    expect(s.wins).toBe(N)
    // ...but the concentration is surfaced.
    expect(summary.flagged ?? 0).toBeGreaterThanOrEqual(1)
  })

  it("one farmer can't push a skin as high as many independent voters", () => {
    const farm = makeDb()
    member(farm, 'F')
    challengers.forEach((c, i) => vote(farm, 'F', 'S', c, i))
    runRefit(farm)
    const farmS = getSkinRating(farm, 'S')

    const organic = makeDb()
    challengers.forEach((c, i) => {
      member(organic, 'u' + i) // 30 distinct voters, one win on S each
      vote(organic, 'u' + i, 'S', c, i)
    })
    const organicSummary = runRefit(organic)
    const organicS = getSkinRating(organic, 'S')

    // Same 30 wins over the same opponents, but capped influence vs. genuine
    // breadth: the farmed skin lands meaningfully lower, and isn't flagged when
    // the wins are spread across many people.
    expect(organicS.rating).toBeGreaterThan(farmS.rating)
    expect(organicSummary.flagged ?? 0).toBe(0)
  })
})

// A Tier Drop submission: one event, many skins placed. These feed the same
// tallies as head-to-head votes, so they have to feed the head count too.
const tierSubmit = (
  db: DatabaseSync,
  userId: string,
  tiers: Record<string, string[]>,
) =>
  db
    .prepare(
      `INSERT INTO game_events (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
       VALUES (?, 'tier-list', '2026-06-15', 'tier_submitted', ?, 'q', 'x', 'guest', '2026-06-15T12:00:00.000Z')`,
    )
    .run(userId, JSON.stringify({ boardId: 'b', tiers }))

describe('skinVoters: how many people, not how much evidence', () => {
  it('counts distinct people, not votes', () => {
    const db = makeDb()
    member(db, 'F')
    // The DONI-93 shape: one person, a pile of battles on one skin.
    Array.from({ length: 12 }, (_, i) => 'c' + i).forEach((c, i) =>
      vote(db, 'F', 'S', c, i),
    )
    expect(skinVoters(db, 'S')).toEqual({ members: 1, guests: 0 })
    expect(getSkinRating(db, 'S').battles).toBe(0) // not refit yet
    runRefit(db)
    // Twelve battles of volume, one opinion behind them. That gap is the bug
    // DONI-94 closes, and it is invisible in the band alone.
    expect(getSkinRating(db, 'S').battles).toBe(12)
  })

  it('sees the skin on either side of the pair', () => {
    const db = makeDb()
    member(db, 'W')
    member(db, 'L')
    vote(db, 'W', 'S', 'other', 0) // S won
    vote(db, 'L', 'other', 'S', 1) // S lost
    expect(skinVoters(db, 'S')).toEqual({ members: 2, guests: 0 })
  })

  it('splits members from signed-out visitors', () => {
    const db = makeDb()
    member(db, 'M')
    db.prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, NULL)').run('G')
    vote(db, 'M', 'S', 'a', 0)
    vote(db, 'G', 'S', 'b', 1)
    // A voter with no game_users row at all is a guest too, not a crash.
    vote(db, 'ghost', 'S', 'c', 2)
    expect(skinVoters(db, 'S')).toEqual({ members: 1, guests: 2 })
  })

  it('counts Tier Drop placements, which also move the rating', () => {
    const db = makeDb()
    member(db, 'T')
    tierSubmit(db, 'T', { S: ['S'], A: ['a', 'b'], D: ['c'] })
    expect(skinVoters(db, 'S')).toEqual({ members: 1, guests: 0 })
    expect(skinVoters(db, 'a')).toEqual({ members: 1, guests: 0 })
    expect(skinVoters(db, 'unplaced')).toEqual({ members: 0, guests: 0 })
  })

  it('does not double-count one person across both modes', () => {
    const db = makeDb()
    member(db, 'T')
    vote(db, 'T', 'S', 'a', 0)
    tierSubmit(db, 'T', { S: ['S'], D: ['a'] })
    expect(skinVoters(db, 'S')).toEqual({ members: 1, guests: 0 })
  })
})
