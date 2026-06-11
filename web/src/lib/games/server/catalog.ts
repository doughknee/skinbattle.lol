// Skin catalog, synced from Riot Data Dragon and cached in SQLite.
//
// One fetch of championFull.json per patch covers every champion's skins.
// This is the seed of the Phase 0 patch-ingestion pipeline: version-aware,
// and a future cron only needs to call ensureCatalog() on a schedule.

import type { DatabaseSync } from 'node:sqlite'

const DD = 'https://ddragon.leagueoflegends.com'
// Re-check the versions endpoint at most this often while a catalog exists.
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000

export interface CatalogSkin {
  id: string
  championId: string
  championName: string
  num: number
  name: string
  splashUrl: string
}

interface DDragonChampion {
  id: string
  name: string
  skins: { id: string; num: number; name: string }[]
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
// unreachable — a slightly old catalog beats a dead game.
export async function ensureCatalog(db: DatabaseSync): Promise<string> {
  const version = getMeta(db, 'dd_version')
  const syncedAt = getMeta(db, 'synced_at')
  const populated = skinCount(db) > 0

  if (
    populated &&
    version &&
    syncedAt &&
    Date.now() - Date.parse(syncedAt) < SYNC_INTERVAL_MS
  ) {
    // Catalog is fresh, but the splash sweep may not have run for this
    // version yet (e.g. a db created before sweeps existed).
    maybeSweepSplashes(db, version)
    return version
  }

  try {
    const versions = (await ddJson(`${DD}/api/versions.json`)) as string[]
    const latest = versions[0]
    if (!latest) throw new Error('empty versions list')

    if (latest !== version || !populated) {
      const full = (await ddJson(
        `${DD}/cdn/${latest}/data/en_US/championFull.json`,
      )) as { data: Record<string, DDragonChampion> }
      replaceCatalog(db, full.data)
      setMeta(db, 'dd_version', latest)
    }
    setMeta(db, 'synced_at', new Date().toISOString())
    maybeSweepSplashes(db, latest)
    return latest
  } catch (err) {
    if (populated && version) {
      console.warn(`catalog sync failed, serving stale ${version}:`, err)
      return version
    }
    throw new Error(
      `Could not load the skin catalog from Data Dragon: ${err instanceof Error ? err.message : err}`,
    )
  }
}

async function ddJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

function replaceCatalog(
  db: DatabaseSync,
  data: Record<string, DDragonChampion>,
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO catalog_skins
       (id, champion_id, champion_name, num, name, splash_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM catalog_skins')
    for (const champ of Object.values(data)) {
      for (const skin of champ.skins) {
        // Base splashes (num 0) are excluded: guessing one is really
        // guess-the-champion, which is LoLdle's game — not Splashdle's.
        if (skin.num === 0) continue
        // Chroma/variant tiers are listed as skins with a parenthesized
        // suffix — "Elderwood Wukong (Pearl)" — but have no splash art of
        // their own (the img CDN 403s). ~6,800 of championFull's ~8,900
        // entries are these.
        if (/\s\([^)]+\)$/.test(skin.name)) continue
        insert.run(
          String(skin.id),
          champ.id,
          champ.name,
          skin.num,
          skin.name,
          `${DD}/cdn/img/champion/splash/${champ.id}_${skin.num}.jpg`,
        )
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// championFull.json has a second class of phantom entries beyond the
// parenthesized chromas filtered at sync: chroma variants with plain names
// ("Zac Sweet Orange", "Worlds 2017 Ashe Chroma" — 64 in patch 16.12) whose
// splash URLs 403. No name pattern catches them reliably, so after each
// patch sync a background sweep HEAD-checks every splash once and clears
// splash_ok on the dead ones. Until the sweep lands (~30 s), the client's
// broken-image fallback covers the gap.
const SWEEP_CONCURRENCY = 32
let sweepRunning = false

function maybeSweepSplashes(db: DatabaseSync, version: string): void {
  if (sweepRunning || getMeta(db, 'splash_sweep_version') === version) return
  sweepRunning = true
  setImmediate(async () => {
    try {
      const skins = db
        .prepare('SELECT id, splash_url AS url FROM catalog_skins')
        .all() as unknown as { id: string; url: string }[]
      const broken: string[] = []
      const queue = [...skins]
      await Promise.all(
        Array.from({ length: SWEEP_CONCURRENCY }, async () => {
          for (let s = queue.pop(); s; s = queue.pop()) {
            try {
              const res = await fetch(s.url, {
                method: 'HEAD',
                signal: AbortSignal.timeout(10_000),
              })
              if (res.status === 403 || res.status === 404) broken.push(s.id)
              // Other failures (5xx, timeouts) are transient — leave the
              // skin in play rather than benching it on a CDN hiccup.
            } catch {
              /* network blip: same call — keep the skin */
            }
          }
        }),
      )
      const clear = db.prepare(
        'UPDATE catalog_skins SET splash_ok = 0 WHERE id = ?',
      )
      for (const id of broken) clear.run(id)
      setMeta(db, 'splash_sweep_version', version)
      console.log(
        `splash sweep (${version}): ${skins.length} checked, ${broken.length} benched`,
      )
    } catch (err) {
      console.error('splash sweep failed:', err)
    } finally {
      sweepRunning = false
    }
  })
}

const SKIN_COLUMNS =
  'id, champion_id AS championId, champion_name AS championName, num, name, splash_url AS splashUrl'

export function getCatalogSkin(
  db: DatabaseSync,
  skinId: string,
): CatalogSkin | null {
  const row = db
    .prepare(`SELECT ${SKIN_COLUMNS} FROM catalog_skins WHERE id = ?`)
    .get(skinId) as unknown as CatalogSkin | undefined
  return row ?? null
}

// Skins eligible for play surfaces — excludes swept-out phantom entries.
export function allCatalogSkins(db: DatabaseSync): CatalogSkin[] {
  return db
    .prepare(
      `SELECT ${SKIN_COLUMNS} FROM catalog_skins WHERE splash_ok = 1 ORDER BY champion_id, num`,
    )
    .all() as unknown as CatalogSkin[]
}
