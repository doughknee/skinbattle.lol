import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { newUrls, parseSitemapUrls } from './submit-indexnow.mjs'
import { runRefit } from '../src/lib/games/server/ratings.ts'
import { skinIsIndexable, MIN_INDEXABLE_BATTLES } from '../src/lib/games/seo.ts'
import { skinSlug } from '../src/lib/games/slug.ts'

describe('parseSitemapUrls', () => {
  it('pulls every <loc> and undoes the XML escaping sitemap.ts applies', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://skinbattle.lol/rankings/all</loc></url>
  <url><loc>https://skinbattle.lol/skins/a&amp;b-1</loc></url>
  <url><loc></loc></url>
</urlset>`
    // The empty <loc> is dropped: an empty string would be submitted as a
    // bare URL and rejected by IndexNow with a 422.
    expect(parseSitemapUrls(xml)).toEqual([
      'https://skinbattle.lol/rankings/all',
      'https://skinbattle.lol/skins/a&b-1',
    ])
  })
})

describe('newUrls', () => {
  it('returns additions only - a URL that left is not re-submitted', () => {
    const before = ['/a', '/b', '/c']
    const after = ['/a', '/c', '/d']
    expect(newUrls(before, after)).toEqual(['/d'])
  })
})

// ── The trigger, demonstrated ────────────────────────────────────
// The claim is that ratings churn cannot fire a submission. Rather than
// asserting it, run real votes through the real refit and show the URL set
// the sitemap would emit is unchanged - so newUrls() finds nothing to send.

function makeDb() {
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

const member = (db, id) =>
  db.prepare('INSERT INTO game_users (id, logto_sub) VALUES (?, ?)').run(id, 'sub-' + id)

let clock = 0
const vote = (db, userId, winnerId, loserId) => {
  const i = clock++
  db.prepare(
    `INSERT INTO game_events (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
     VALUES (?, 'quick-battle', '2026-09-11', 'battle_voted', ?, 'q', 'x', 'member', ?)`,
  ).run(
    userId,
    JSON.stringify({ winnerId, loserId }),
    `2026-09-11T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
  )
}

// The skin half of sitemapXmlResponse(), verbatim: the same battles-by-skin
// query and the same skinIsIndexable() gate. If that gate moves, this moves
// with it - which is the whole point of submitting from the sitemap.
const CATALOG = [
  { id: 'S', name: 'Subject Skin' },
  { id: 'C0', name: 'Challenger Zero' },
  { id: 'C1', name: 'Challenger One' },
  { id: 'C2', name: 'Challenger Two' },
  { id: 'C3', name: 'Challenger Three' },
]
const ORIGIN = 'https://skinbattle.lol'

function sitemapUrls(db) {
  const battlesBySkin = new Map(
    db.prepare('SELECT skin_id, battles FROM skin_ratings').all().map((r) => [r.skin_id, r.battles]),
  )
  return CATALOG.filter((s) => skinIsIndexable(battlesBySkin.get(s.id)))
    .map((s) => `${ORIGIN}/skins/${skinSlug(s.name, s.id)}`)
    .sort()
}

const ratingsOf = (db) =>
  db.prepare('SELECT skin_id, rating, battles FROM skin_ratings ORDER BY skin_id').all()

describe('ratings churn does not enter the sitemap, so it cannot submit', () => {
  it('a vote, a battle and a refit move ratings but add no URL', () => {
    const db = makeDb()
    ;['v1', 'v2', 'v3', 'v4'].forEach((v) => member(db, v))

    // S earns exactly the threshold, so it is already in the sitemap.
    vote(db, 'v1', 'S', 'C0')
    vote(db, 'v2', 'S', 'C1')
    vote(db, 'v3', 'S', 'C2')
    runRefit(db)

    const before = sitemapUrls(db)
    const ratingsBefore = ratingsOf(db)
    expect(before).toEqual([`${ORIGIN}/skins/subject-skin-S`])

    // One more real vote → a real battle → a real refit.
    vote(db, 'v4', 'C3', 'S')
    runRefit(db)

    const after = sitemapUrls(db)
    const ratingsAfter = ratingsOf(db)

    // The churn is real: battles climbed and the ratings actually moved.
    expect(ratingsAfter).not.toEqual(ratingsBefore)
    expect(ratingsAfter.find((r) => r.skin_id === 'S').battles).toBe(4)
    expect(ratingsBefore.find((r) => r.skin_id === 'S').battles).toBe(3)

    // And the sweep still has nothing to send.
    expect(after).toEqual(before)
    expect(newUrls(before, after)).toEqual([])
  })

  it('but a skin crossing the threshold does add exactly that one URL', () => {
    const db = makeDb()
    ;['v1', 'v2', 'v3'].forEach((v) => member(db, v))
    vote(db, 'v1', 'S', 'C0')
    vote(db, 'v2', 'S', 'C1')
    vote(db, 'v3', 'S', 'C2')
    runRefit(db)
    const before = sitemapUrls(db)

    // C0 is one battle short of the bar; these take it over.
    expect(MIN_INDEXABLE_BATTLES).toBe(3)
    vote(db, 'v2', 'C0', 'C3')
    vote(db, 'v3', 'C0', 'C3')
    runRefit(db)

    expect(newUrls(before, sitemapUrls(db))).toEqual([
      `${ORIGIN}/skins/challenger-zero-C0`,
    ])
  })
})
