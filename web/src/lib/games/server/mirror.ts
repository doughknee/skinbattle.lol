// The Mirror (server-only): a read surface over the rating data Quick
// Battle generates — personal tier list, contrarian takes, taste profile,
// wardrobe completion. Design principle 2: this is the killer feature; every
// battle sharpens the user's own reflection, not just the global ranking.
//
// Strictly read-only: viewing the mirror never mints a user, never writes a
// row (peekUser, never ensureUser). All numbers derive from
// user_skin_ratings / skin_ratings, which are themselves derived from the
// append-only game_events log.

import type { DatabaseSync } from 'node:sqlite'
import type {
  ChampionCompletion,
  ContrarianTake,
  MirrorSkin,
  MirrorState,
  MirrorTier,
  TasteEntry,
  TierName,
} from '../types'
import { getDb } from './db'
import { ensureCatalog } from './catalog'
import { peekUser } from './guests'
import { globalRank } from './ratings'
import { userBattleCounts } from './quickbattle'
import { skinSets } from './facts'

// ─── tuning ─────────────────────────────────────────────────────────────────

// Tier floors on the personal Elo scale (start 1500, K=48). Chosen so the
// FIRST battle already moves a skin out of B (one win ≈ 1524 → A, one loss
// ≈ 1476 → C — the mirror answers back immediately), while the extremes are
// earned: S takes ~4 straight wins, D ~5 straight losses. B is the narrow
// "the jury's split" band around the start rating.
const TIER_FLOORS: [TierName, number][] = [
  ['S', 1590],
  ['A', 1520],
  ['B', 1480],
  ['C', 1410],
  ['D', -Infinity],
]

// A contrarian take needs a real sample on BOTH sides, or it's noise: the
// user must have fought the skin more than once, and the community rating
// must rest on enough battles to mean something.
const CONTRARIAN_MIN_PERSONAL = 2
const CONTRARIAN_MIN_COMMUNITY = 8
const CONTRARIAN_MIN_GAP = 50
const CONTRARIAN_LIMIT = 8

// Taste profile: a group (skin line or champion) only counts once multiple
// of its skins are rated (one skin says nothing about the group), and only
// deltas clear of Elo jitter make the list.
const TASTE_MIN_SKINS = 2
const TASTE_MIN_DELTA = 20
const TASTE_LIMIT = 3

// Wardrobe completion list cap — the rest collapses into "+N more".
const COMPLETION_LIMIT = 12

// ─── data assembly ──────────────────────────────────────────────────────────

interface RatedRow {
  skinId: string
  name: string
  championId: string
  championName: string
  splashUrl: string
  personal: number
  personalBattles: number
  community: number | null
  communityBattles: number | null
}

function loadRatedRows(db: DatabaseSync, userId: string): RatedRow[] {
  return db
    .prepare(
      `SELECT u.skin_id AS skinId, c.name AS name,
              c.champion_id AS championId, c.champion_name AS championName,
              c.splash_url AS splashUrl,
              u.rating AS personal, u.battles AS personalBattles,
              r.rating AS community, r.battles AS communityBattles
       FROM user_skin_ratings u
       JOIN catalog_skins c ON c.id = u.skin_id AND c.splash_ok = 1
       LEFT JOIN skin_ratings r ON r.skin_id = u.skin_id
       WHERE u.user_id = ? AND u.battles > 0
       ORDER BY u.rating DESC`,
    )
    .all(userId) as unknown as RatedRow[]
}

function toMirrorSkin(r: RatedRow): MirrorSkin {
  return {
    skinId: r.skinId,
    name: r.name,
    championName: r.championName,
    splashUrl: r.splashUrl,
    rating: Math.round(r.personal),
    battles: r.personalBattles,
  }
}

// Bucket by fixed floors (not quantiles): a skin only changes tier when ITS
// rating moves, so the list is stable under new battles elsewhere — and a
// tier means the same thing for every user.
function buildTiers(rows: RatedRow[]): MirrorTier[] {
  return TIER_FLOORS.map(([tier, floor], i) => {
    const ceil = i === 0 ? Infinity : TIER_FLOORS[i - 1][1]
    return {
      tier,
      skins: rows
        .filter((r) => r.personal >= floor && r.personal < ceil)
        .map(toMirrorSkin),
    }
  })
}

function buildContrarian(db: DatabaseSync, rows: RatedRow[]): ContrarianTake[] {
  return rows
    .filter(
      (r) =>
        r.community !== null &&
        r.personalBattles >= CONTRARIAN_MIN_PERSONAL &&
        (r.communityBattles ?? 0) >= CONTRARIAN_MIN_COMMUNITY &&
        Math.abs(r.personal - r.community) >= CONTRARIAN_MIN_GAP,
    )
    .sort(
      (a, b) =>
        Math.abs(b.personal - b.community!) - Math.abs(a.personal - a.community!),
    )
    .slice(0, CONTRARIAN_LIMIT)
    .map((r) => ({
      skinId: r.skinId,
      name: r.name,
      championName: r.championName,
      splashUrl: r.splashUrl,
      personal: Math.round(r.personal),
      community: Math.round(r.community!),
      communityRank: globalRank(db, r.community!),
      gap: Math.round(r.personal - r.community!),
      personalBattles: r.personalBattles,
      communityBattles: r.communityBattles ?? 0,
    }))
}

// Over/under-indexing relative to the user's own average, grouped by skin
// line (the Meraki facts dataset's `set` tags — "you over-index on Coven")
// and by champion. Both pools compete on |delta|; entries carry their kind.
function buildTaste(rows: RatedRow[]): {
  over: TasteEntry[]
  under: TasteEntry[]
} {
  if (rows.length === 0) return { over: [], under: [] }
  const overallAvg = rows.reduce((s, r) => s + r.personal, 0) / rows.length

  const groups = new Map<
    string,
    { kind: TasteEntry['kind']; name: string; ratings: number[] }
  >()
  const add = (kind: TasteEntry['kind'], name: string, rating: number) => {
    const key = `${kind}:${name}`
    const g = groups.get(key) ?? { kind, name, ratings: [] }
    g.ratings.push(rating)
    groups.set(key, g)
  }
  for (const r of rows) {
    add('champion', r.championName, r.personal)
    for (const set of skinSets(r.skinId)) add('line', set, r.personal)
  }

  const entries: TasteEntry[] = [...groups.entries()]
    .filter(([, g]) => g.ratings.length >= TASTE_MIN_SKINS)
    .map(([key, g]) => ({
      kind: g.kind,
      id: key,
      name: g.name,
      delta: Math.round(
        g.ratings.reduce((s, v) => s + v, 0) / g.ratings.length - overallAvg,
      ),
      skinsRated: g.ratings.length,
    }))

  return {
    over: entries
      .filter((e) => e.delta >= TASTE_MIN_DELTA)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, TASTE_LIMIT),
    under: entries
      .filter((e) => e.delta <= -TASTE_MIN_DELTA)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, TASTE_LIMIT),
  }
}

// Per-champion wardrobe completion for champions the user has touched —
// principle 4: the collector itch wearing a progress bar.
function buildCompletion(
  db: DatabaseSync,
  rows: RatedRow[],
): { list: ChampionCompletion[]; more: number } {
  const totals = new Map(
    (
      db
        .prepare(
          `SELECT champion_id AS id, champion_name AS name, COUNT(*) AS total
           FROM catalog_skins WHERE splash_ok = 1 GROUP BY champion_id`,
        )
        .all() as unknown as { id: string; name: string; total: number }[]
    ).map((r) => [r.id, r]),
  )

  const rated = new Map<string, number>()
  for (const r of rows) rated.set(r.championId, (rated.get(r.championId) ?? 0) + 1)

  const list = [...rated.entries()]
    .map(([championId, count]) => {
      const t = totals.get(championId)
      return {
        championId,
        championName: t?.name ?? championId,
        rated: count,
        total: t?.total ?? count,
      }
    })
    .sort(
      (a, b) =>
        b.rated / b.total - a.rated / a.total ||
        b.rated - a.rated ||
        a.championName.localeCompare(b.championName),
    )

  return {
    list: list.slice(0, COMPLETION_LIMIT),
    more: Math.max(0, list.length - COMPLETION_LIMIT),
  }
}

// ─── public surface (called from server functions) ──────────────────────────

export async function mirrorState(
  restoreToken?: string | null,
): Promise<MirrorState> {
  const db = getDb()
  await ensureCatalog(db)

  const catalog = db
    .prepare(
      `SELECT COUNT(*) AS skins, COUNT(DISTINCT champion_id) AS champions
       FROM catalog_skins WHERE splash_ok = 1`,
    )
    .get() as { skins: number; champions: number }

  const known = peekUser(db, restoreToken)
  const base: MirrorState = {
    guestToken: known?.token ?? '',
    tier: known?.user.trustTier ?? 'guest',
    totalBattles: 0,
    skinsRated: 0,
    catalogTotal: catalog.skins,
    championsTouched: 0,
    championsTotal: catalog.champions,
    tiers: [],
    contrarian: [],
    tasteOver: [],
    tasteUnder: [],
    completion: [],
    completionMore: 0,
  }
  if (!known) return base

  const rows = loadRatedRows(db, known.user.id)
  if (rows.length === 0) return base

  const taste = buildTaste(rows)
  const completion = buildCompletion(db, rows)
  return {
    ...base,
    totalBattles: userBattleCounts(db, known.user.id).total,
    skinsRated: rows.length,
    championsTouched: new Set(rows.map((r) => r.championId)).size,
    tiers: buildTiers(rows),
    contrarian: buildContrarian(db, rows),
    tasteOver: taste.over,
    tasteUnder: taste.under,
    completion: completion.list,
    completionMore: completion.more,
  }
}
