// Dev-only helper: synthesize a crowd of guest votes so community ratings
// diverge from the most active local user's — for exercising the Mirror's
// contrarian takes without a second human. Writes the same rows the real
// vote path writes (guest game_users rows + append-only battle_voted
// events); it deliberately does NOT touch skin_ratings — run the
// Bradley-Terry refit afterwards so the canonical path rebuilds them:
//
//   node web/scripts/seed-crowd.mjs [votesPerSkin=10] [userId]
//   then open http://localhost:3000/games/quick-battle?refit=
//
// userId defaults to the most recent voter; pass it explicitly when several
// local guests exist (your browser's is under localStorage 'sb:guest-token'
// → game_users.guest_token).
//
// The crowd contradicts the target user: it votes DOWN their favorites and
// UP their least favorites, which is exactly the divergence contrarian
// takes need.
import { randomUUID, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const db = new DatabaseSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'games.db'),
)
const votesPerSkin = Number(process.argv[2] ?? 10)

// The local player = the given user id, or whoever battled most recently.
const me = process.argv[3]
  ? { id: process.argv[3] }
  : db
      .prepare(
        `SELECT user_id AS id FROM game_events
         WHERE type = 'battle_voted' ORDER BY id DESC LIMIT 1`,
      )
      .get()
if (!me) {
  console.error('No user_skin_ratings yet — play some Quick Battle first.')
  process.exit(1)
}

// Their strongest opinions: top and bottom personally-rated skins. Battling
// these up makes them community-dense, which both qualifies them on the
// contrarian community threshold AND pulls them into dunk/marquee range so
// the matchmaker re-deals them to the player (raising personal counts too).
const mine = db
  .prepare(
    `SELECT skin_id AS skinId, rating FROM user_skin_ratings
     WHERE user_id = ? AND battles >= 1 ORDER BY rating DESC`,
  )
  .all(me.id)
if (mine.length < 4) {
  console.error('Need a few personally-rated skins — play Quick Battle first.')
  process.exit(1)
}
const favorites = mine.slice(0, 10)
const leastFavorites = mine.slice(-10).filter((s) => !favorites.includes(s))

// Opponent pool: any other catalog skins (the crowd needs someone to vote
// the target skins against).
const pool = db
  .prepare(
    `SELECT id FROM catalog_skins WHERE splash_ok = 1 ORDER BY id LIMIT 400`,
  )
  .all()
  .map((r) => r.id)

const now = () => new Date().toISOString()
const today = now().slice(0, 10)

// A handful of crowd guests so the votes don't all hang off one user.
const crowdIds = []
const insertUser = db.prepare(
  'INSERT INTO game_users (id, guest_token, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
)
for (let i = 0; i < 5; i++) {
  const id = randomUUID()
  insertUser.run(id, randomBytes(16).toString('hex'), now(), now())
  crowdIds.push(id)
}

const insertEvent = db.prepare(
  `INSERT INTO game_events
     (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
   VALUES (?, 'quick-battle', ?, 'battle_voted', ?, 'which-do-you-like-more', ?, 'guest', ?)`,
)
const assetVersion =
  db.prepare(`SELECT v FROM catalog_meta WHERE k = 'dd_version'`).get()?.v ??
  'seed'

let n = 0
const vote = (winnerId, loserId, i) => {
  const pairKey = winnerId < loserId ? `${winnerId}|${loserId}` : `${loserId}|${winnerId}`
  insertEvent.run(
    crowdIds[i % crowdIds.length],
    today,
    JSON.stringify({ winnerId, loserId, pairKey, pairType: 'seed', weight: 0.5 }),
    assetVersion,
    now(),
  )
  n++
}

db.exec('BEGIN')
// The crowd hates what the player loves...
for (const s of favorites) {
  for (let i = 0; i < votesPerSkin; i++) {
    const opp = pool[(i * 37) % pool.length]
    if (opp !== s.skinId) vote(opp, s.skinId, i)
  }
}
// ...and loves what the player hates.
for (const s of leastFavorites) {
  for (let i = 0; i < votesPerSkin; i++) {
    const opp = pool[(i * 53 + 7) % pool.length]
    if (opp !== s.skinId) vote(s.skinId, opp, i)
  }
}
db.exec('COMMIT')

console.log(
  `Seeded ${n} crowd votes against user ${me.id} (${favorites.length} favorites voted down, ${leastFavorites.length} least-favorites voted up).`,
)
console.log(
  'Now trigger the refit so skin_ratings rebuild from the event log:',
)
console.log('  http://localhost:3000/games/quick-battle?refit=')
