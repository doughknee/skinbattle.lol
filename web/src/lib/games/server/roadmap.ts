// Live totals for the public roadmap (server-only). Fully anonymous derived
// data: battle volume and rating coverage from the games database, star and
// ban totals from the Go API. The roadmap's whole pitch is "your battles
// unlock what comes next", so these numbers must be the real ones the phase
// gates in GAMES_ROADMAP.md actually use.

import type { RoadmapState } from '../types'
import { getDb } from './db'
import { allCatalogSkins, ensureCatalog } from './catalog'
import { communityBattleCount } from './quickbattle'
import { api } from '../../api'

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

  // Star/ban totals live in the Go API. The roadmap still works without
  // them, so an unreachable API degrades to nulls instead of a failed page.
  let starsGiven: number | null = null
  let bansCast: number | null = null
  try {
    const skins = await api.skins()
    starsGiven = skins.reduce((sum, s) => sum + s.total_stars, 0)
    bansCast = skins.reduce((sum, s) => sum + s.total_x, 0)
  } catch {
    // Leave the totals null; the page hides those counters.
  }

  return { battles, ratedSkins, totalSkins, medianBattles, starsGiven, bansCast }
}
