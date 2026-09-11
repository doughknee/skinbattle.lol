import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// status.ts pulls the live file-backed singleton; hand it an in-memory db.
let testDb: DatabaseSync
vi.mock('./db', () => ({ getDb: () => testDb }))

const { gamesStatusResponse } = await import('./status')

// Only the tables status.ts touches.
function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE catalog_skins (id TEXT PRIMARY KEY, num INTEGER NOT NULL);
    CREATE TABLE game_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      game TEXT NOT NULL, puzzle_date TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
      question_asked TEXT NOT NULL, asset_version TEXT NOT NULL, trust_tier TEXT NOT NULL,
      created_at TEXT NOT NULL);
    CREATE TABLE catalog_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  return db
}

const event = (db: DatabaseSync, game: string, type: string) =>
  db
    .prepare(
      `INSERT INTO game_events (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
       VALUES ('u1', ?, '2026-06-15', ?, '{}', 'q', 'x', 'member', '2026-06-15T00:00:00.000Z')`,
    )
    .run(game, type)

const body = async () =>
  (await gamesStatusResponse()).json() as Promise<{
    problems: string[]
    catalog: Record<string, unknown>
    ratings: { ratingEvents: number; eventsSinceRefit: number }
  }>

beforeEach(() => {
  testDb = makeDb()
})

describe('games status', () => {
  // The reported -12: at refit time there were 12 tier submissions and 1 vote,
  // so the baseline is 13 — but the status read counted only battle_voted (1).
  // Both sides must count the same population as the refit's own baseline.
  it('measures refit lag in the same units the refit stamps', async () => {
    event(testDb, 'quick-battle', 'battle_voted')
    for (let i = 0; i < 12; i++) event(testDb, 'tier-list', 'tier_submitted')
    testDb
      .prepare("INSERT INTO catalog_meta (k, v) VALUES ('refit_events', '13')")
      .run()

    const { ratings } = await body()
    expect(ratings.ratingEvents).toBe(13)
    expect(ratings.eventsSinceRefit).toBe(0) // was -12
  })

  // An inflated baseline also silently disarmed the overdue alarm: the delta
  // was short by the tier-submission total, so it never crossed the threshold.
  it('still flags a refit that has fallen far behind', async () => {
    event(testDb, 'quick-battle', 'battle_voted')
    for (let i = 0; i < 12; i++) event(testDb, 'tier-list', 'tier_submitted')
    testDb
      .prepare("INSERT INTO catalog_meta (k, v) VALUES ('refit_events', '13')")
      .run()
    for (let i = 0; i < 2001; i++) event(testDb, 'quick-battle', 'battle_voted')

    const { problems } = await body()
    expect(problems).toContain('2001 rating events since the last refit')
  })

  it('drops the splash-sweep fossil (nothing has written it since 894c395)', async () => {
    const { catalog } = await body()
    expect(catalog).not.toHaveProperty('splashSweepVersion')
  })
})
