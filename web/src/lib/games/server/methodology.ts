// Provenance figures for /methodology (server-only, read-only).
//
// The methodology page states how thin the data currently is, in numbers, and
// those numbers have to be live or the page is just a claim about itself. All
// of this is aggregate counts over skin_ratings plus two meta keys - no join
// to the catalog, no per-skin work.

import type { MethodologyState } from '../types'
import { MAX_CONFIDENT_UNCERTAINTY } from '../answer'
import { MIN_INDEXABLE_BATTLES } from '../seo'
import { getDb } from './db'
import { ensureCatalog, getMeta } from './catalog'
import { factsSnapshotAt } from './facts'

const one = <T>(db: ReturnType<typeof getDb>, sql: string, ...args: number[]) =>
  db.prepare(sql).get(...args) as T

export async function methodologyState(): Promise<MethodologyState> {
  const db = getDb()
  await ensureCatalog(db)

  const catalogSkins = one<{ c: number }>(
    db,
    'SELECT COUNT(*) AS c FROM catalog_skins WHERE num != 0',
  ).c
  const ratedSkins = one<{ c: number }>(
    db,
    'SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0',
  ).c
  const battleEvents = one<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM game_events WHERE type IN ('battle_voted', 'tier_submitted')`,
  ).c
  const indexableSkins = one<{ c: number }>(
    db,
    'SELECT COUNT(*) AS c FROM skin_ratings WHERE battles >= ?',
    MIN_INDEXABLE_BATTLES,
  ).c
  const confidentSkins = one<{ c: number }>(
    db,
    'SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0 AND uncertainty <= ?',
    MAX_CONFIDENT_UNCERTAINTY,
  ).c

  // No MEDIAN() in SQLite; one indexed offset read beats pulling 1,900 rows.
  const medianBattles =
    ratedSkins > 0
      ? one<{ battles: number }>(
          db,
          'SELECT battles FROM skin_ratings WHERE battles > 0 ORDER BY battles LIMIT 1 OFFSET ?',
          Math.floor(ratedSkins / 2),
        ).battles
      : 0

  const widest = one<{ u: number | null }>(
    db,
    'SELECT MAX(uncertainty) AS u FROM skin_ratings WHERE battles > 0',
  ).u
  const tightest = one<{ u: number | null }>(
    db,
    'SELECT MIN(uncertainty) AS u FROM skin_ratings WHERE battles > 0',
  ).u

  return {
    catalogSkins,
    ratedSkins,
    battleEvents,
    indexableSkins,
    confidentSkins,
    medianBattles,
    widestBand: widest === null ? null : Math.round(widest),
    tightestBand: tightest === null ? null : Math.round(tightest),
    refitAt: getMeta(db, 'refit_at'),
    catalogSyncedAt: getMeta(db, 'synced_at'),
    factsSnapshotAt,
  }
}
