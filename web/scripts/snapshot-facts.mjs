// Static skin-facts snapshot (GAMES_ROADMAP, Phase 0 "static skin facts
// dataset"): pulls per-skin RP cost, rarity, availability, skin lines, and
// release dates from the Meraki Analytics CDN and commits them as
// web/src/lib/games/data/skin-facts.json.
//
// Meraki is community-maintained, so we snapshot it into our own committed
// dataset and never depend on it at runtime — run this script on patch
// cadence (alongside catalog sync) and commit the diff.
//
//   node web/scripts/snapshot-facts.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const DD = 'https://ddragon.leagueoflegends.com'
const MERAKI =
  'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions'
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'games',
  'data',
  'skin-facts.json',
)

const json = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

const versions = await json(`${DD}/api/versions.json`)
const patch = versions[0]
const full = await json(`${DD}/cdn/${patch}/data/en_US/championFull.json`)
const championIds = Object.keys(full.data)
console.log(`patch ${patch}, ${championIds.length} champions`)

const facts = {}
const failed = []
const queue = [...championIds]
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let id = queue.pop(); id; id = queue.pop()) {
      try {
        const champ = await json(`${MERAKI}/${id}.json`)
        for (const s of champ.skins) {
          if (s.isBase) continue
          facts[String(s.id)] = {
            cost: typeof s.cost === 'number' ? s.cost : null,
            rarity: s.rarity ?? null,
            availability: s.availability ?? null,
            sets: Array.isArray(s.set) ? s.set : [],
            release: s.release ?? null,
          }
        }
      } catch (err) {
        failed.push(`${id}: ${err.message}`)
      }
    }
  }),
)

if (failed.length > 0) {
  console.warn(`FAILED champions (${failed.length}):`)
  for (const f of failed) console.warn(' ', f)
}
// A mostly-empty snapshot means Meraki moved or broke — don't commit that.
if (Object.keys(facts).length < 1000) {
  console.error(`only ${Object.keys(facts).length} skins — refusing to write`)
  process.exit(1)
}

const costs = {}
for (const f of Object.values(facts)) costs[f.cost] = (costs[f.cost] ?? 0) + 1
console.log('cost distribution:', costs)

// Idempotent: if the DATA is unchanged, leave the file alone (including its
// snapshotAt) — the scheduled refresh workflow only opens a PR on a real
// diff, not on a timestamp churn.
const skinsJson = JSON.stringify(facts)
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  if (prev.patch === patch && JSON.stringify(prev.skins) === skinsJson) {
    console.log('no changes — snapshot left untouched')
    process.exit(0)
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  JSON.stringify(
    { snapshotAt: new Date().toISOString(), patch, skins: facts },
    null,
    1,
  ),
)
console.log(`wrote ${Object.keys(facts).length} skins → ${OUT}`)
