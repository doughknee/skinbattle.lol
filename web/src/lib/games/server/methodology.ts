// Provenance figures for /methodology (server-only, read-only).
//
// The methodology page states how thin the data currently is, in numbers, and
// those numbers have to be live or the page is just a claim about itself.
//
// Every figure over skin_ratings goes through RATED_IN_CATALOG - the same
// join ratedCount() and globalRank() use. Counting skin_ratings on its own
// put this page at "1,944 with battle data" against "1,941 in the catalog":
// seven rating rows for skins a Community Dragon sync had since dropped.
// More rated skins than skins is the one sentence a provenance page can
// never print.

import type { MethodologyState } from '../types'
import { MAX_CONFIDENT_UNCERTAINTY } from '../answer'
import { MIN_INDEXABLE_BATTLES } from '../seo'
import { getDb } from './db'
import { catalogSkinTotal, ensureCatalog, getMeta } from './catalog'
import { factsSnapshotAt } from './facts'
import { ratedCount, ratingEventCount, RATED_IN_CATALOG } from './ratings'

const one = <T>(db: ReturnType<typeof getDb>, sql: string, ...args: number[]) =>
  db.prepare(sql).get(...args) as T

export async function methodologyState(): Promise<MethodologyState> {
  const db = getDb()
  await ensureCatalog(db)

  const catalogSkins = catalogSkinTotal(db)
  const ratedSkins = ratedCount(db)
  const battleEvents = ratingEventCount(db)
  const indexableSkins = one<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c ${RATED_IN_CATALOG} AND r.battles >= ?`,
    MIN_INDEXABLE_BATTLES,
  ).c
  const confidentSkins = one<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c ${RATED_IN_CATALOG} AND r.uncertainty <= ?`,
    MAX_CONFIDENT_UNCERTAINTY,
  ).c

  // No MEDIAN() in SQLite; one indexed offset read beats pulling 1,900 rows.
  const medianBattles =
    ratedSkins > 0
      ? one<{ battles: number }>(
          db,
          `SELECT r.battles ${RATED_IN_CATALOG} ORDER BY r.battles LIMIT 1 OFFSET ?`,
          Math.floor(ratedSkins / 2),
        ).battles
      : 0

  const widest = one<{ u: number | null }>(
    db,
    `SELECT MAX(r.uncertainty) AS u ${RATED_IN_CATALOG}`,
  ).u
  const tightest = one<{ u: number | null }>(
    db,
    `SELECT MIN(r.uncertainty) AS u ${RATED_IN_CATALOG}`,
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
