// Dev inspection helper: dump Quick Battle state from games.db.
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const db = new DatabaseSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'games.db'),
)
const q = (sql, ...args) => db.prepare(sql).all(...args)

console.log(
  'events by type:',
  q(
    `SELECT type, COUNT(*) AS n FROM game_events WHERE game = 'quick-battle' GROUP BY type`,
  ),
)
console.log(
  'pair types:',
  q(
    `SELECT json_extract(payload, '$.pairType') AS t, COUNT(*) AS n
     FROM game_events WHERE game = 'quick-battle' AND type = 'battle_voted' GROUP BY t`,
  ),
)
console.log(
  'top ratings:',
  q(
    `SELECT s.name, r.rating, r.uncertainty, r.battles, r.wins
     FROM skin_ratings r JOIN catalog_skins s ON s.id = r.skin_id
     ORDER BY r.rating DESC LIMIT 10`,
  ),
)
console.log(
  'personal rows:',
  q(`SELECT COUNT(*) AS n FROM user_skin_ratings`),
)
console.log(
  'meta:',
  q(`SELECT k, v FROM catalog_meta WHERE k IN ('refit_at','refit_events')`),
)
console.log(
  'last 5 events:',
  q(
    `SELECT payload, trust_tier, created_at FROM game_events
     WHERE game = 'quick-battle' AND type = 'battle_voted'
     ORDER BY id DESC LIMIT 5`,
  ),
)
