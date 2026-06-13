// Snapshot the live catalog into a deterministic fixture for the search
// completeness tests (src/lib/search/search-completeness.test.ts).
//
// Joins the synced catalog (web/.data/games.db → catalog_skins) with the
// committed skin-line snapshot (src/lib/games/data/skin-facts.json → sets),
// mirroring skinSets()'s "Legacy is availability, not a theme" filter.
//
// Re-run after a catalog re-sync so the tests track reality:
//   node scripts/gen-search-fixture.mjs
//
// The test does NOT regenerate this itself — checking in the fixture keeps the
// suite offline and deterministic, and makes catalog drift show up as a diff.

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const DB_PATH = join(root, '.data', 'games.db')
const FACTS_PATH = join(root, 'src', 'lib', 'games', 'data', 'skin-facts.json')
const OUT_PATH = join(root, 'src', 'lib', 'search', '__fixtures__', 'catalog.json')

const facts = JSON.parse(readFileSync(FACTS_PATH, 'utf8'))
// Mirror skinSets(): a skin's themes are its sets minus the "Legacy" bucket.
const setsFor = (id) => (facts.skins[id]?.sets ?? []).filter((s) => s !== 'Legacy')

const db = new DatabaseSync(DB_PATH, { readOnly: true })
const rows = db
  .prepare(
    `SELECT id, champion_id, champion_name, num, name
       FROM catalog_skins
      ORDER BY champion_id, num`,
  )
  .all()
db.close()

const skins = rows.map((r) => ({
  id: String(r.id),
  championId: r.champion_id,
  championName: r.champion_name,
  num: Number(r.num),
  name: r.name,
  sets: setsFor(String(r.id)),
}))

// Distinct champions, preserving the championId → championName mapping.
const champMap = new Map()
for (const s of skins) if (!champMap.has(s.championId)) champMap.set(s.championId, s.championName)
const champions = [...champMap].map(([id, name]) => ({ id, name }))

const fixture = {
  generatedFrom: 'web/.data/games.db + skin-facts.json',
  factsSnapshotAt: facts.snapshotAt ?? null,
  championCount: champions.length,
  skinCount: skins.length,
  champions,
  skins,
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(fixture, null, 2) + '\n')
console.log(
  `wrote ${OUT_PATH}\n  ${champions.length} champions, ${skins.length} skins, ` +
    `${skins.filter((s) => s.sets.length).length} skins with a skin line`,
)
