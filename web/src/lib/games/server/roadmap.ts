// Live totals for the public roadmap (server-only). Fully anonymous derived
// data: battle volume and rating coverage from the games database. The
// roadmap's whole pitch is "your battles unlock what comes next", so these
// numbers must be the real ones the phase gates in GAMES_ROADMAP.md use.

import type { RoadmapState } from '../types'
import { getDb } from './db'
import { allCatalogSkins, ensureCatalog } from './catalog'
import { communityBattleCount } from './quickbattle'

export async function roadmapState(): Promise<RoadmapState> {
  const db = getDb()
  await ensureCatalog(db)

  const battles = communityBattleCount(db)
  const totalSkins = allCatalogSkins(db).length

  const rated = db
    .prepare(
      'SELECT battles FROM skin_ratings WHERE battles > 0 ORDER BY battles',
    )
    .all() as unknown as { battles: number }[]
  const ratedSkins = rated.length
  const medianBattles =
    ratedSkins > 0 ? rated[Math.floor(ratedSkins / 2)].battles : 0

  return { battles, ratedSkins, totalSkins, medianBattles }
}
