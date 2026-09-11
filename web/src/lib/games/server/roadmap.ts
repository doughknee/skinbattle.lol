// Live totals for the public roadmap (server-only). Fully anonymous derived
// data: battle volume and rating coverage from the games database. The
// roadmap's whole pitch is "your battles unlock what comes next", so these
// numbers must be the real ones the phase gates in GAMES_ROADMAP.md use.

import type { RoadmapState } from '../types'
import { getDb } from './db'
import { catalogSkinTotal, ensureCatalog } from './catalog'
import { communityBattleCount } from './quickbattle'
import { RATED_IN_CATALOG } from './ratings'

export async function roadmapState(): Promise<RoadmapState> {
  const db = getDb()
  await ensureCatalog(db)

  const battles = communityBattleCount(db)
  const totalSkins = catalogSkinTotal(db)

  // Catalog-joined like every other rated count, so the meter's "N of M"
  // cannot count rating rows for skins the catalog dropped.
  const rated = db
    .prepare(`SELECT r.battles ${RATED_IN_CATALOG} ORDER BY r.battles`)
    .all() as unknown as { battles: number }[]
  const ratedSkins = rated.length
  const medianBattles =
    ratedSkins > 0 ? rated[Math.floor(ratedSkins / 2)].battles : 0

  return { battles, ratedSkins, totalSkins, medianBattles }
}
