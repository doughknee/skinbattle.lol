// Skin catalog, synced from Community Dragon and cached in SQLite.
//
// One fetch of CommunityDragon's skins.json covers every champion's skins
// with complete per-skin art (splash / tile / loadscreen / uncentered) -
// including the newest skins Data Dragon's splash CDN lacks. Champion id and
// display name come from Data Dragon's champion.json, whose patch number is
// the asset_version stamped on every game event. Version-aware: a future cron
// only needs to call ensureCatalog() on a schedule.

import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import type {
  CatalogSkinEntry,
  CatalogState,
  ChampionWardrobeState,
} from '../types'
import { skinSlug } from '../slug'
import { getDb } from './db'

const DD = 'https://ddragon.leagueoflegends.com'
const CDRAGON =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'
// Re-check the versions endpoint at most this often while a catalog exists.
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000
// Forces a one-time re-import when the INGEST changes without a League patch
// bump (e.g. the Data Dragon → Community Dragon art switch). Without it a
// catalog already at the current patch - on a persistent volume - never
// rebuilds. Bump whenever the stored art/columns must be regenerated.
const CATALOG_REV = 'cdragon-1'

export interface CatalogSkin {
  id: string
  championId: string
  championName: string
  num: number
  name: string
  splashUrl: string
  tileUrl: string
  loadscreenUrl: string
  uncenteredSplashUrl: string
}

// Data Dragon champion summary - key (numeric, as string) → id + display name.
interface DDragonChampion {
  id: string
  key: string
  name: string
}

// CommunityDragon skin entry (only the fields we read).
interface CDragonSkin {
  id: number
  isBase: boolean
  name: string
  splashPath: string | null
  uncenteredSplashPath: string | null
  tilePath: string | null
  loadScreenPath: string | null
}

// Turn a CommunityDragon asset path into a CDN URL. Paths look like
// "/lol-game-data/assets/ASSETS/Characters/Aatrox/.../x.jpg"; the CDN serves
// them lowercased under the global/default root. The host is never lowercased.
function cdragonAsset(path: string | null | undefined): string {
  if (!path) return ''
  return CDRAGON + path.replace(/^\/lol-game-data\/assets/i, '').toLowerCase()
}

export function getMeta(db: DatabaseSync, k: string): string | null {
  const row = db.prepare('SELECT v FROM catalog_meta WHERE k = ?').get(k) as
    | { v: string }
    | undefined
  return row?.v ?? null
}

export function setMeta(db: DatabaseSync, k: string, v: string): void {
  db.prepare(
    'INSERT INTO catalog_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v',
  ).run(k, v)
}

function skinCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM catalog_skins').get() as {
    c: number
  }
  return row.c
}

// Make sure the catalog exists and is reasonably fresh. Returns the Data
// Dragon patch version the catalog was built from (the asset_version stamped
// on every game event). Falls back to the stale catalog if Riot is
// unreachable - a slightly old catalog beats a dead game.
export async function ensureCatalog(db: DatabaseSync): Promise<string> {
  const version = getMeta(db, 'dd_version')
  const syncedAt = getMeta(db, 'synced_at')
  const populated = skinCount(db) > 0
  const revCurrent = getMeta(db, 'catalog_rev') === CATALOG_REV

  if (
    populated &&
    version &&
    syncedAt &&
    revCurrent &&
    Date.now() - Date.parse(syncedAt) < SYNC_INTERVAL_MS
  ) {
    return version
  }

  try {
    const versions = (await ddJson(`${DD}/api/versions.json`)) as string[]
    const latest = versions[0]
    if (!latest) throw new Error('empty versions list')

    // The skin list comes from Community Dragon, which updates on its own
    // clock: a patch's new skins can land there hours after Data Dragon's
    // version bumps, and entries get added or dropped mid-patch. Keying the
    // re-import on the version alone froze the catalog with whatever CDragon
    // held the first time each version was seen - production ran a patch
    // behind on two skins while the Go API, synced later, had them. So the
    // fetch happens every check and the import is keyed on the CONTENT: the
    // set of importable ids, fingerprinted.
    const champData = (await ddJson(
      `${DD}/cdn/${latest}/data/en_US/champion.json`,
    )) as { data: Record<string, DDragonChampion> }
    const skins = (await ddJson(`${CDRAGON}/v1/skins.json`)) as Record<
      string,
      CDragonSkin
    >
    const fingerprint = catalogFingerprint(champData.data, skins)
    if (
      latest !== version ||
      !populated ||
      !revCurrent ||
      fingerprint !== getMeta(db, 'catalog_fingerprint')
    ) {
      replaceCatalog(db, champData.data, skins)
      setMeta(db, 'dd_version', latest)
      setMeta(db, 'catalog_rev', CATALOG_REV)
      setMeta(db, 'catalog_fingerprint', fingerprint)
    }
    setMeta(db, 'synced_at', new Date().toISOString())
    return latest
  } catch (err) {
    if (populated && version) {
      console.warn(`catalog sync failed, serving stale ${version}:`, err)
      return version
    }
    throw new Error(
      `Could not load the skin catalog: ${err instanceof Error ? err.message : err}`,
    )
  }
}

async function ddJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

// Champion key (numeric) → { id, display name }.
function championsByKey(
  champions: Record<string, DDragonChampion>,
): Map<number, { id: string; name: string }> {
  const byKey = new Map<number, { id: string; name: string }>()
  for (const c of Object.values(champions)) {
    byKey.set(Number(c.key), { id: c.id, name: c.name })
  }
  return byKey
}

// A stable digest of what replaceCatalog would import: every skin id whose
// champion Data Dragon lists, plus its name (renames must re-import too).
// Same filter as the import, so a difference means the stored catalog is
// behind the upstream one and nothing else.
export function catalogFingerprint(
  champions: Record<string, DDragonChampion>,
  skins: Record<string, CDragonSkin>,
): string {
  const byKey = championsByKey(champions)
  const entries = Object.values(skins)
    .filter((s) => byKey.has(Math.floor(s.id / 1000)))
    .map((s) => `${s.id}:${s.name}`)
    .sort()
  return createHash('sha1').update(entries.join('\n')).digest('hex')
}

function replaceCatalog(
  db: DatabaseSync,
  champions: Record<string, DDragonChampion>,
  skins: Record<string, CDragonSkin>,
): void {
  const byKey = championsByKey(champions)

  const insert = db.prepare(
    `INSERT OR REPLACE INTO catalog_skins
       (id, champion_id, champion_name, num, name,
        splash_url, tile_url, loadscreen_url, uncentered_splash_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM catalog_skins')
    for (const skin of Object.values(skins)) {
      // skin.id = championKey * 1000 + num. Base skins (num 0) are kept in
      // the catalog but excluded from guess pools by allCatalogSkins.
      const champ = byKey.get(Math.floor(skin.id / 1000))
      if (!champ) continue // a champion Data Dragon doesn't list this patch
      const splash = cdragonAsset(skin.splashPath)
      insert.run(
        String(skin.id),
        champ.id,
        champ.name,
        skin.id % 1000,
        skin.name,
        splash,
        cdragonAsset(skin.tilePath) || splash,
        cdragonAsset(skin.loadScreenPath) || splash,
        cdragonAsset(skin.uncenteredSplashPath) || splash,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

const SKIN_COLUMNS = `id, champion_id AS championId, champion_name AS championName,
   num, name, splash_url AS splashUrl, tile_url AS tileUrl,
   loadscreen_url AS loadscreenUrl, uncentered_splash_url AS uncenteredSplashUrl`

// ─── the counts every public page prints ────────────────────────────────────
//
// One definition each, here, and every surface reads it from here: the home
// page counters, /skins, /champions, the champion pages, the ranking slices,
// /methodology and the dossiers. The Go API's Postgres catalog is NOT a
// source for any public count - it carries base looks (num 0) and syncs on
// its own schedule, and production printed 2,116 / 1,943 / 1,941 for what
// readers took to be one number until every page was routed through here.
//
// "Skin" means a skin someone can own: catalog rows with num != 0. The base
// look (num 0) stays in the table for direct lookups and the Tier Drop
// baseline, and is never counted.

// Skins in the catalog, base looks excluded. The denominator /skins, the
// methodology page and the dossier's coverage bar all print.
export function catalogSkinTotal(db: DatabaseSync): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM catalog_skins WHERE num != 0')
    .get() as { c: number }
  return row.c
}

// Champions with at least one ownable skin - the same set /champions lists
// and the sitemap walks.
export function championCount(db: DatabaseSync): number {
  const row = db
    .prepare(
      'SELECT COUNT(DISTINCT champion_id) AS c FROM catalog_skins WHERE num != 0',
    )
    .get() as { c: number }
  return row.c
}

export interface RosterEntry {
  championId: string
  championName: string
  // The base look's splash, the roster card art. Falls back to the first
  // skin's when a champion somehow has no num 0 row.
  splashUrl: string
  // Ownable skins - exactly championSkins(db, championId).length.
  skinCount: number
}

// The champion directory: one row per champion, base splash, and the count
// the champion page will print. Derived in one statement from the same
// num != 0 rule so the two cannot disagree.
export function championRoster(db: DatabaseSync): RosterEntry[] {
  return db
    .prepare(
      `SELECT champion_id AS championId,
              MAX(champion_name) AS championName,
              COALESCE(MAX(CASE WHEN num = 0 THEN splash_url END),
                       MIN(splash_url)) AS splashUrl,
              SUM(num != 0) AS skinCount
         FROM catalog_skins
        GROUP BY champion_id
       HAVING skinCount > 0
        ORDER BY champion_id`,
    )
    .all() as unknown as RosterEntry[]
}

export function getCatalogSkin(
  db: DatabaseSync,
  skinId: string,
): CatalogSkin | null {
  const row = db
    .prepare(`SELECT ${SKIN_COLUMNS} FROM catalog_skins WHERE id = ?`)
    .get(skinId) as unknown as CatalogSkin | undefined
  return row ?? null
}

// Skins eligible for play surfaces. Base skins (num 0) live in the catalog
// for direct lookups but are never dealt into guess/battle pools.
export function allCatalogSkins(db: DatabaseSync): CatalogSkin[] {
  return db
    .prepare(
      `SELECT ${SKIN_COLUMNS} FROM catalog_skins
       WHERE num != 0 ORDER BY champion_id, num`,
    )
    .all() as unknown as CatalogSkin[]
}

// One champion's wardrobe, base look excluded and in release order - the same
// set /skins, the battle pool and the champion page count, so a dossier's
// sibling links can never disagree with the champion page linking to it.
export function championSkins(
  db: DatabaseSync,
  championId: string,
): CatalogSkin[] {
  return db
    .prepare(
      `SELECT ${SKIN_COLUMNS} FROM catalog_skins
       WHERE champion_id = ? AND num != 0 ORDER BY num`,
    )
    .all(championId) as unknown as CatalogSkin[]
}

// ─── the catalog door ───────────────────────────────────────────────────────

const toEntry = (s: CatalogSkin): CatalogSkinEntry => ({
  id: s.id,
  num: s.num,
  name: s.name,
  slug: skinSlug(s.name, s.id),
  championId: s.championId,
  championName: s.championName,
  splashUrl: s.splashUrl,
})

// /skins and /champions: the flat list and the roster, from this catalog and
// nothing else. Both lenses used to read the Go API's Postgres catalog, which
// carries base looks and syncs on its own clock - so /skins said 1,943 while
// every ranking said 1,941, and /champions gave Ahri 21 skins to the champion
// page's 20.
export async function catalogState(): Promise<CatalogState> {
  const db = getDb()
  await ensureCatalog(db)
  return {
    champions: championRoster(db),
    skins: allCatalogSkins(db).map(toEntry),
  }
}

// One champion's wardrobe, resolved case-insensitively (the route redirects
// to the lowercase id). Null when the catalog has no such champion.
export async function championWardrobe(
  championId: string,
): Promise<ChampionWardrobeState | null> {
  const db = getDb()
  await ensureCatalog(db)
  const row = db
    .prepare(
      'SELECT champion_id AS championId FROM catalog_skins WHERE LOWER(champion_id) = LOWER(?) LIMIT 1',
    )
    .get(championId) as { championId: string } | undefined
  if (!row) return null
  const skins = championSkins(db, row.championId).map(toEntry)
  const base = championBaseSkin(db, row.championId)
  return {
    championId: row.championId,
    championName: base?.championName ?? skins[0]?.championName ?? row.championId,
    splashUrl: base?.splashUrl ?? skins[0]?.splashUrl ?? null,
    skins,
  }
}

// A champion's base (num 0) skin — the default look. The Tier List uses it
// as a baseline anchor for champion boards; the champion page as hero art.
export function championBaseSkin(
  db: DatabaseSync,
  championId: string,
): CatalogSkin | null {
  const row = db
    .prepare(`SELECT ${SKIN_COLUMNS} FROM catalog_skins WHERE champion_id = ? AND num = 0`)
    .get(championId) as unknown as CatalogSkin | undefined
  return row ?? null
}

// Every base (num 0) skin — used by the Tier List's champion-board candidate
// generation so coverage scoring and board hashes include the baseline.
export function baseCatalogSkins(db: DatabaseSync): CatalogSkin[] {
  return db
    .prepare(`SELECT ${SKIN_COLUMNS} FROM catalog_skins WHERE num = 0 ORDER BY champion_id`)
    .all() as unknown as CatalogSkin[]
}
