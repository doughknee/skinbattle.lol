// Static skin-facts snapshot (GAMES_ROADMAP, Phase 0 "static skin facts
// dataset"): pulls per-skin RP cost, rarity, availability, skin lines, and
// release dates and commits them as web/src/lib/games/data/skin-facts.json.
//
// Primary source: the League of Legends Wiki's Module:SkinData/data — the
// community dataset Meraki Analytics used to mirror. Meraki's CDN froze
// around patch 25.06 (mid-2025), so we read the wiki directly now. Rarity
// isn't tracked there; it comes from CommunityDragon as a best-effort
// top-up (nothing reads it yet — on failure, previous values carry over).
//
// Both are community-maintained, so we snapshot into our own committed
// dataset and never depend on either at runtime — run this script on patch
// cadence (alongside catalog sync) and commit the diff.
//
//   node web/scripts/snapshot-facts.mjs
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const DD = 'https://ddragon.leagueoflegends.com'
const WIKI_SKINDATA =
  'https://wiki.leagueoflegends.com/en-us/Module:SkinData/data?action=raw'
const CD_SKINS =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skins.json'
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'games',
  'data',
  'skin-facts.json',
)

const HEADERS = { 'User-Agent': 'skinbattle.lol facts-snapshot (bot)' }

const fetchText = async (url, timeout = 30_000) => {
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

const fetchJson = async (url, timeout = 30_000) =>
  JSON.parse(await fetchText(url, timeout))

// ── Minimal Lua-table parser ─────────────────────────────────────────
// Module:SkinData/data is machine-serialized Lua: every key is bracketed
// (["key"] = …), values are strings, numbers, booleans, or nested tables.
// Anything outside that grammar throws, so a wiki format change fails the
// run loudly instead of producing a quietly-wrong snapshot.
function parseLua(src) {
  let i = 0
  const err = (msg) => {
    throw new Error(
      `lua parse: ${msg} at ${i}: …${src.slice(Math.max(0, i - 40), i + 40)}…`,
    )
  }
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src.startsWith('--', i)) {
        while (i < src.length && src[i] !== '\n') i++
      } else return
    }
  }
  const string_ = () => {
    const quote = src[i++]
    let out = ''
    while (i < src.length) {
      const c = src[i++]
      if (c === '\\') {
        const e = src[i++]
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e
      } else if (c === quote) return out
      else out += c
    }
    err('unterminated string')
  }
  const value = () => {
    ws()
    const c = src[i]
    if (c === '{') return table()
    if (c === '"' || c === "'") return string_()
    if (src.startsWith('true', i)) return (i += 4), true
    if (src.startsWith('false', i)) return (i += 5), false
    if (src.startsWith('nil', i)) return (i += 3), null
    const m = /^-?\d+(\.\d+)?/.exec(src.slice(i, i + 32))
    if (m) return (i += m[0].length), Number(m[0])
    err('unexpected value')
  }
  const table = () => {
    i++ // consume {
    const obj = {}
    const list = []
    let keyed = false
    for (;;) {
      ws()
      if (i >= src.length) err('unterminated table')
      if (src[i] === '}') {
        i++
        break
      }
      if (src[i] === '[') {
        i++
        const k = value()
        ws()
        if (src[i] !== ']') err('expected ]')
        i++
        ws()
        if (src[i] !== '=') err('expected =')
        i++
        obj[k] = value()
        keyed = true
      } else {
        list.push(value())
      }
      ws()
      if (src[i] === ',' || src[i] === ';') i++
    }
    return keyed ? obj : list
  }
  ws()
  if (!src.startsWith('return', i)) err('expected return')
  i += 'return'.length
  return value()
}

// ── Fetch ────────────────────────────────────────────────────────────
const versions = await fetchJson(`${DD}/api/versions.json`)
const patch = versions[0]

const wiki = parseLua(await fetchText(WIKI_SKINDATA))

// Rarity top-up from CommunityDragon (skin id → "Epic"/"Legendary"/…).
// Best-effort: a CD outage must not block a facts refresh, so on failure
// the previous snapshot's rarities carry forward instead of churning to
// null across the whole file.
const rarityById = new Map()
try {
  const cd = await fetchJson(CD_SKINS, 60_000)
  for (const [id, s] of Object.entries(cd)) {
    const r = typeof s.rarity === 'string' ? s.rarity.replace(/^k/, '') : ''
    if (r && r !== 'NoRarity') rarityById.set(id, r)
  }
} catch (err) {
  console.warn(`CommunityDragon rarity fetch failed (${err.message})`)
  if (existsSync(OUT)) {
    console.warn('carrying previous rarities forward')
    const prev = JSON.parse(readFileSync(OUT, 'utf8'))
    for (const [id, f] of Object.entries(prev.skins)) {
      if (f.rarity) rarityById.set(id, f.rarity)
    }
  }
}

// ── Extract ──────────────────────────────────────────────────────────
// Wiki entries are champion name → { id (numeric champion key), skins:
// { name → { id (skin num), cost, availability, set, release, … } } }.
// The game's skin id is championKey * 1000 + skinNum — the same number
// Data Dragon stamps, so the join needs no name matching.
const facts = {}
let champions = 0
for (const champ of Object.values(wiki)) {
  if (typeof champ?.id !== 'number' || typeof champ?.skins !== 'object') continue
  champions++
  for (const s of Object.values(champ.skins)) {
    if (typeof s?.id !== 'number' || s.id === 0) continue // base skin
    if (s.availability === 'Canceled') continue // never shipped
    const skinId = String(champ.id * 1000 + s.id)
    facts[skinId] = {
      cost: typeof s.cost === 'number' ? s.cost : null,
      rarity: rarityById.get(skinId) ?? null,
      availability: typeof s.availability === 'string' ? s.availability : null,
      sets: Array.isArray(s.set) ? s.set.filter((x) => typeof x === 'string') : [],
      release:
        typeof s.release === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.release)
          ? s.release
          : null,
    }
  }
}
console.log(
  `patch ${patch}: ${champions} champions, ${Object.keys(facts).length} skins from the wiki`,
)

// A mostly-empty snapshot means the wiki moved or broke — don't commit that.
if (Object.keys(facts).length < 1000) {
  console.error(`only ${Object.keys(facts).length} skins — refusing to write`)
  process.exit(1)
}

const all = Object.values(facts)
const costs = {}
for (const f of all) costs[f.cost] = (costs[f.cost] ?? 0) + 1
console.log('cost distribution:', costs)
const avail = {}
for (const f of all) avail[f.availability] = (avail[f.availability] ?? 0) + 1
console.log('availability distribution:', avail)
const releases = all.map((f) => f.release).filter(Boolean).sort()
console.log(
  `releases: ${releases.length} dated, newest ${releases[releases.length - 1]}`,
)

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
