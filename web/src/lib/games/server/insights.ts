// Insights: the Skin Drought Index (server-only). "Days since last skin"
// per champion, derived entirely from the committed facts dataset's release
// dates + the live catalog — zero community data needed, citable from day
// one (GAMES_ROADMAP, Insights track #1). Skin-drought discourse is a
// permanent Reddit genre; this page is the link that settles it.

import type { DatabaseSync } from 'node:sqlite'
import type { DroughtRow, DroughtState } from '../types'
import { getDb } from './db'
import { allCatalogSkins, ensureCatalog } from './catalog'
import { factsFor } from './facts'
import { utcToday } from './daily'

const DAY_MS = 86_400_000

export async function droughtIndex(): Promise<DroughtState> {
  const db: DatabaseSync = getDb()
  await ensureCatalog(db)
  const date = utcToday()
  const todayMs = Date.parse(`${date}T00:00:00Z`)

  interface Acc {
    championName: string
    skinCount: number
    last: { id: string; name: string; splashUrl: string; release: string } | null
  }
  const byChampion = new Map<string, Acc>()
  for (const skin of allCatalogSkins(db)) {
    const acc = byChampion.get(skin.championId) ?? {
      championName: skin.championName,
      skinCount: 0,
      last: null,
    }
    acc.skinCount += 1
    const release = factsFor(skin.id)?.release
    if (release && (!acc.last || release > acc.last.release)) {
      acc.last = {
        id: skin.id,
        name: skin.name,
        splashUrl: skin.splashUrl,
        release,
      }
    }
    byChampion.set(skin.championId, acc)
  }

  const rows: Omit<DroughtRow, 'rank'>[] = []
  const undated: DroughtState['undated'] = []
  for (const [championId, acc] of byChampion) {
    if (!acc.last) {
      undated.push({
        championId,
        championName: acc.championName,
        skinCount: acc.skinCount,
      })
      continue
    }
    rows.push({
      championId,
      championName: acc.championName,
      days: Math.max(
        0,
        Math.floor((todayMs - Date.parse(`${acc.last.release}T00:00:00Z`)) / DAY_MS),
      ),
      lastSkinId: acc.last.id,
      lastSkinName: acc.last.name,
      lastSkinSplashUrl: acc.last.splashUrl,
      lastSkinDate: acc.last.release,
      skinCount: acc.skinCount,
    })
  }

  rows.sort(
    (a, b) => b.days - a.days || a.championName.localeCompare(b.championName),
  )
  undated.sort((a, b) => a.championName.localeCompare(b.championName))

  const ranked: DroughtRow[] = rows.map((r, i) => ({ ...r, rank: i + 1 }))
  return {
    date,
    rows: ranked,
    undated,
    stats: {
      champions: ranked.length,
      longestDays: ranked[0]?.days ?? 0,
      overTwoYears: ranked.filter((r) => r.days >= 730).length,
      averageDays:
        ranked.length > 0
          ? Math.round(ranked.reduce((s, r) => s + r.days, 0) / ranked.length)
          : 0,
    },
  }
}
