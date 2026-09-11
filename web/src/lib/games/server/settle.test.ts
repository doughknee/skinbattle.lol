// The /settle hub judges 170 champions in one pass. Two things can drift and
// both are guarded here: the aggregate voter query must give the same answer
// skinVoters() gives for one skin (that function is the definition), and the
// builder must apply answer.ts's two bars the way the champion page does.

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { MAX_CONFIDENT_UNCERTAINTY, MIN_CONFIDENT_VOTERS } from '../answer'
import { skinVoters } from './ratings'
import { allSkinVoters, buildSettleRows, needsYou, type HubSkin } from './settle'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE game_users (id TEXT PRIMARY KEY, logto_sub TEXT);
    CREATE TABLE game_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      game TEXT NOT NULL, puzzle_date TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
      question_asked TEXT NOT NULL, asset_version TEXT NOT NULL, trust_tier TEXT NOT NULL,
      created_at TEXT NOT NULL);
  `)
  return db
}

const user = (db: DatabaseSync, id: string, member: boolean) =>
  db
    .prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)')
    .run(id, member ? `sub-${id}` : null)

const event = (db: DatabaseSync, userId: string, game: string, type: string, payload: object) =>
  db
    .prepare(
      `INSERT INTO game_events (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
       VALUES (?, ?, '2026-09-11', ?, ?, 'q', 'x', 'guest', '2026-09-11T00:00:00.000Z')`,
    )
    .run(userId, game, type, JSON.stringify(payload))

describe('allSkinVoters', () => {
  it('agrees with skinVoters for every skin, across both battle modes', () => {
    const db = makeDb()
    user(db, 'm1', true)
    user(db, 'm2', true)
    user(db, 'g1', false)
    // m1 votes on the same pair twice: one head, not two.
    event(db, 'm1', 'quick-battle', 'battle_voted', { winnerId: 'a', loserId: 'b' })
    event(db, 'm1', 'quick-battle', 'battle_voted', { winnerId: 'b', loserId: 'a' })
    event(db, 'g1', 'quick-battle', 'battle_voted', { winnerId: 'a', loserId: 'c' })
    // A Tier Drop board names every placed skin at once.
    event(db, 'm2', 'tier-list', 'tier_submitted', { tiers: { S: ['a'], B: ['c', 'd'] } })
    // A voter whose user row is gone counts as a guest, exactly as skinVoters.
    event(db, 'ghost', 'quick-battle', 'battle_voted', { winnerId: 'd', loserId: 'a' })

    const all = allSkinVoters(db)
    for (const skin of ['a', 'b', 'c', 'd']) {
      expect(all.get(skin), skin).toEqual(skinVoters(db, skin))
    }
    expect(all.get('a')).toEqual({ members: 2, guests: 2 })
    expect(all.get('b')).toEqual({ members: 1, guests: 0 })
    expect(all.has('zzz')).toBe(false)
  })
})

const skin = (
  id: string,
  championId: string,
  battles: number,
  rating: number | null = null,
  uncertainty: number | null = null,
): HubSkin => ({
  id,
  name: id,
  championId,
  championName: championId,
  rating,
  uncertainty,
  battles,
})

describe('buildSettleRows', () => {
  const voters = new Map([
    ['ahri-1', { members: MIN_CONFIDENT_VOTERS, guests: 0 }],
    ['lux-1', { members: 1, guests: 1 }],
    ['yone-1', { members: 5, guests: 0 }],
  ])
  const rows = buildSettleRows(
    [
      // Settled: tight band, enough people.
      skin('ahri-1', 'Ahri', 40, 1650, MAX_CONFIDENT_UNCERTAINTY - 5),
      skin('ahri-2', 'Ahri', 12, 1500, 120),
      skin('ahri-3', 'Ahri', 0),
      // Provisional on the head count alone: band is in, 1.5 weighted voters.
      skin('lux-1', 'Lux', 30, 1600, MAX_CONFIDENT_UNCERTAINTY),
      // Provisional on the band: plenty of people, still wide.
      skin('yone-1', 'Yone', 6, 1580, MAX_CONFIDENT_UNCERTAINTY + 40),
      // Nobody has touched it.
      skin('zed-1', 'Zed', 0),
      skin('zed-2', 'Zed', 0),
    ],
    voters,
  )
  const byId = new Map(rows.map((r) => [r.championId, r]))

  it('applies both bars, and names the one still missing', () => {
    expect(byId.get('Ahri')).toMatchObject({ state: 'settled', missing: null, rated: 2, total: 3 })
    expect(byId.get('Lux')).toMatchObject({ state: 'provisional', missing: 'voters' })
    expect(byId.get('Yone')).toMatchObject({ state: 'provisional', missing: 'band' })
    expect(byId.get('Zed')).toMatchObject({ state: 'empty', missing: null, leader: null, total: 2 })
  })

  it('judges the leader by the rounded band the pages print, with heads at face value', () => {
    expect(byId.get('Ahri')!.leader).toEqual({
      name: 'ahri-1',
      band: MAX_CONFIDENT_UNCERTAINTY - 5,
      battles: 40,
      voters: MIN_CONFIDENT_VOTERS,
    })
    expect(byId.get('Lux')!.leader!.voters).toBe(2)
  })

  it('lists what needs you: a head count away first, then by band, then the untouched, and never the settled', () => {
    expect(needsYou(rows).map((r) => r.championId)).toEqual(['Lux', 'Yone', 'Zed'])
  })
})
