// Home page state (server-only): the daily hero slide set plus the live
// numbers the landing sections run on.
//
// The hero set is deterministic from the UTC date — everyone sees the same
// six skins, same as the dailies (see ./daily). A couple of slots go to
// current Elo headliners so the slideshow opens strong; the rest are seeded
// picks from the whole catalog, deduped by champion so one wardrobe never
// dominates the day.

import type { DatabaseSync } from 'node:sqlite'
import type { HomeSlide, HomeState } from '../types'
import { getDb } from './db'
import { allCatalogSkins, ensureCatalog, type CatalogSkin } from './catalog'
import { factsFor } from './facts'
import { seedFloats, utcToday } from './daily'
import { getSkinRating, globalRank } from './ratings'
import { communityBattleCount } from './quickbattle'
import { droughtIndex } from './insights'
import { skinSlug } from '../slug'

const SLIDE_COUNT = 6
// Slides drawn from the current top of the Elo board (when one exists).
const HEADLINER_SLOTS = 2
const HEADLINER_POOL = 20
// Drought rows surfaced on the home page.
const DROUGHT_ROWS = 3

function ratedCount(db: DatabaseSync): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0')
    .get() as { c: number }
  return row.c
}

function topRatedSkins(db: DatabaseSync, catalog: CatalogSkin[]): CatalogSkin[] {
  const ids = (
    db
      .prepare(
        'SELECT skin_id FROM skin_ratings WHERE battles > 0 ORDER BY rating DESC LIMIT ?',
      )
      .all(HEADLINER_POOL) as unknown as { skin_id: string }[]
  ).map((r) => r.skin_id)
  const byId = new Map(catalog.map((s) => [s.id, s]))
  return ids.map((id) => byId.get(id)).filter((s): s is CatalogSkin => !!s)
}

function pickSlides(db: DatabaseSync, date: string): CatalogSkin[] {
  const catalog = allCatalogSkins(db)
  // Only skins with a known RP price — the overlay's price line should
  // never read "unknown" on the front page.
  const field = catalog.filter((s) => factsFor(s.id)?.cost != null)
  if (field.length === 0) return []

  const floats = seedFloats(`home-hero:${date}`, 96)
  let cursor = 0
  const next = () => floats[cursor++ % floats.length]

  const picked: CatalogSkin[] = []
  const champions = new Set<string>()
  const take = (pool: CatalogSkin[]): void => {
    // Bounded retries keep the draw deterministic even when the pool is
    // mostly duplicates of champions already on stage.
    for (let i = 0; i < 24; i++) {
      const skin = pool[Math.floor(next() * pool.length)]
      if (!skin || champions.has(skin.championId)) continue
      picked.push(skin)
      champions.add(skin.championId)
      return
    }
  }

  const headliners = topRatedSkins(db, catalog)
  for (let i = 0; i < HEADLINER_SLOTS && headliners.length > 0; i++) {
    take(headliners)
  }
  while (picked.length < SLIDE_COUNT) {
    const before = picked.length
    take(field)
    if (picked.length === before) break // pool exhausted of new champions
  }
  return picked
}

export async function homeState(): Promise<HomeState> {
  const db = getDb()
  await ensureCatalog(db)
  const date = utcToday()

  const slides: HomeSlide[] = pickSlides(db, date).map((s) => {
    const r = getSkinRating(db, s.id)
    return {
      skinId: s.id,
      slug: skinSlug(s.name, s.id),
      name: s.name,
      championId: s.championId,
      championName: s.championName,
      splashUrl: s.splashUrl,
      cost: factsFor(s.id)?.cost ?? null,
      rank: r.battles > 0 ? globalRank(db, r.rating) : null,
      battles: r.battles,
    }
  })

  const drought = await droughtIndex()

  return {
    date,
    slides,
    community: {
      battles: communityBattleCount(db),
      rated: ratedCount(db),
      catalog: allCatalogSkins(db).length,
    },
    drought:
      drought.rows.length > 0
        ? { top: drought.rows.slice(0, DROUGHT_ROWS), stats: drought.stats }
        : null,
  }
}
