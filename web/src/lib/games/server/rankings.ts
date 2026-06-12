// Ranking slices (server-only): the sliced-rankings layer of the Insights
// track - best skins per price tier, skin line, champion, or release year
// ("best 975 RP skins" is a purchasing guide nobody does well). Every slice
// is a stable URL; thin data renders as "Early Rankings - still calibrating"
// with battle counts visible, per the cold-start strategy.

import type { DatabaseSync } from 'node:sqlite'
import type {
  RankingRow,
  RankingsIndex,
  RankingsState,
  SliceLink,
} from '../types'
import { getDb } from './db'
import { allCatalogSkins, ensureCatalog, type CatalogSkin } from './catalog'
import { factsFor, PRICE_TIERS } from './facts'
import { kebab, skinSlug } from '../slug'

// Page size: the route loads the first page server-side and "Show more"
// pulls deeper pages by offset.
const ROW_CAP = 100
// Roadmap threshold: rankings count as calibrated once the median rated
// skin has ~10 battles.
const CALIBRATED_MEDIAN = 10
// A skin line needs a few members before "best of" means anything.
const LINE_MIN_SKINS = 4

// ─── slice resolution ───────────────────────────────────────────────────────

interface Slice {
  title: string
  subtitle: string
  match: (skin: CatalogSkin) => boolean
}

// Skin lines keyed by their kebab slug ("k-da" → "K/DA"). Built per call -
// it's a few thousand string ops over the in-memory facts table.
function lineBySlug(db: DatabaseSync): Map<string, string> {
  const map = new Map<string, string>()
  for (const skin of allCatalogSkins(db)) {
    for (const set of factsFor(skin.id)?.sets ?? []) {
      if (set !== 'Legacy') map.set(kebab(set), set)
    }
  }
  return map
}

function resolveSlice(db: DatabaseSync, slice: string): Slice | null {
  if (slice === 'all') {
    return {
      title: 'All skins',
      subtitle: 'The whole catalog, ranked by community battles.',
      match: () => true,
    }
  }
  const price = /^price-(\d+)$/.exec(slice)
  if (price) {
    const tier = Number(price[1])
    if (!(PRICE_TIERS as readonly number[]).includes(tier)) return null
    return {
      title: `Best ${tier.toLocaleString()} RP skins`,
      subtitle: `Every ${tier.toLocaleString()} RP skin, ranked. The purchasing guide.`,
      match: (s) => factsFor(s.id)?.cost === tier,
    }
  }
  const year = /^year-(\d{4})$/.exec(slice)
  if (year) {
    return {
      title: `Best skins of ${year[1]}`,
      subtitle: `Everything Riot shipped in ${year[1]}, ranked.`,
      match: (s) => factsFor(s.id)?.release?.startsWith(year[1]) ?? false,
    }
  }
  const line = /^line-(.+)$/.exec(slice)
  if (line) {
    const name = lineBySlug(db).get(line[1])
    if (!name) return null
    return {
      title: `Best ${name} skins`,
      subtitle: `The ${name} line, ranked by community battles.`,
      match: (s) => factsFor(s.id)?.sets.includes(name) ?? false,
    }
  }
  const champ = /^champion-(.+)$/.exec(slice)
  if (champ) {
    const id = champ[1].toLowerCase()
    const skin = allCatalogSkins(db).find(
      (s) => s.championId.toLowerCase() === id,
    )
    if (!skin) return null
    return {
      title: `Best ${skin.championName} skins`,
      subtitle: `${skin.championName}'s wardrobe, ranked by community battles.`,
      match: (s) => s.championId === skin.championId,
    }
  }
  return null
}

// ─── state ──────────────────────────────────────────────────────────────────

export async function rankingsState(
  slice: string,
  offset = 0,
): Promise<RankingsState | null> {
  const db = getDb()
  await ensureCatalog(db)
  const resolved = resolveSlice(db, slice)
  if (!resolved) return null

  const ratings = new Map(
    (
      db
        .prepare(
          'SELECT skin_id, rating, uncertainty, battles FROM skin_ratings WHERE battles > 0',
        )
        .all() as unknown as {
        skin_id: string
        rating: number
        uncertainty: number
        battles: number
      }[]
    ).map((r) => [r.skin_id, r]),
  )

  const members = allCatalogSkins(db).filter(resolved.match)
  const rated = members
    .map((s) => ({ skin: s, r: ratings.get(s.id) }))
    .filter((x): x is { skin: CatalogSkin; r: NonNullable<typeof x.r> } => !!x.r)
    .sort((a, b) => b.r.rating - a.r.rating)

  const battles = rated.map((x) => x.r.battles).sort((a, b) => a - b)
  const medianBattles =
    battles.length > 0 ? battles[Math.floor(battles.length / 2)] : 0

  // Clamp the page start: negative or fractional input degrades to page
  // one, past-the-end yields an empty page (the client stops asking).
  const start = Math.min(Math.max(0, Math.trunc(offset)), rated.length)
  const rows: RankingRow[] = rated.slice(start, start + ROW_CAP).map((x, i) => ({
    rank: start + i + 1,
    skinId: x.skin.id,
    slug: skinSlug(x.skin.name, x.skin.id),
    name: x.skin.name,
    championName: x.skin.championName,
    splashUrl: x.skin.splashUrl,
    rating: Math.round(x.r.rating),
    uncertainty: Math.round(x.r.uncertainty),
    battles: x.r.battles,
    cost: factsFor(x.skin.id)?.cost ?? null,
  }))

  return {
    slice,
    title: resolved.title,
    subtitle: resolved.subtitle,
    rows,
    ratedCount: rated.length,
    totalCount: members.length,
    medianBattles,
    calibrating: medianBattles < CALIBRATED_MEDIAN,
  }
}

// ─── index ──────────────────────────────────────────────────────────────────

export async function rankingsIndex(): Promise<RankingsIndex> {
  const db = getDb()
  await ensureCatalog(db)
  const skins = allCatalogSkins(db)

  const prices: SliceLink[] = PRICE_TIERS.map((tier) => ({
    slice: `price-${tier}`,
    label: `${tier.toLocaleString()} RP`,
    count: skins.filter((s) => factsFor(s.id)?.cost === tier).length,
  })).filter((p) => p.count > 0)

  const yearCounts = new Map<string, number>()
  const lineCounts = new Map<string, number>()
  const champCounts = new Map<string, { name: string; count: number }>()
  for (const s of skins) {
    const f = factsFor(s.id)
    const y = f?.release?.slice(0, 4)
    if (y) yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1)
    for (const set of f?.sets ?? []) {
      if (set !== 'Legacy') lineCounts.set(set, (lineCounts.get(set) ?? 0) + 1)
    }
    const c = champCounts.get(s.championId) ?? { name: s.championName, count: 0 }
    c.count += 1
    champCounts.set(s.championId, c)
  }

  return {
    prices,
    years: [...yearCounts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([y, count]) => ({ slice: `year-${y}`, label: y, count })),
    lines: [...lineCounts.entries()]
      .filter(([, count]) => count >= LINE_MIN_SKINS)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ slice: `line-${kebab(name)}`, label: name, count })),
    champions: [...champCounts.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, c]) => ({
        slice: `champion-${id.toLowerCase()}`,
        label: c.name,
        count: c.count,
      })),
  }
}

// ─── catalog Elo index ──────────────────────────────────────────────────────

// The whole catalog's Elo standing in one list, for catalog-wide sorts (the
// skins page's "Battle Rating" sort). Rank is sitewide among rated skins.
export function catalogEloIndex(): {
  skinId: string
  rating: number
  rank: number
}[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT skin_id, rating FROM skin_ratings WHERE battles > 0 ORDER BY rating DESC',
    )
    .all() as unknown as { skin_id: string; rating: number }[]
  return rows.map((r, i) => ({ skinId: r.skin_id, rating: r.rating, rank: i + 1 }))
}
