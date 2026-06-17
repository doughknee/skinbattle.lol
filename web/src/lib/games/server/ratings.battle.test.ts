import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { getSkinRating, runRefit } from './ratings'

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
