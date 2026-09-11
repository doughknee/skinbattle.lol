// The /settle hub (server-only): which champion rankings still need
// participation, judged by the same two bars answer.ts applies to every
// champion page - the leader's band, and the separate people behind it.
//
// One pass over the catalog and the ratings, ONE aggregate voter query over
// the whole event log (skinVoters() is per skin; 170 champion leaders would
// be 170 scans), then a pure builder decides each champion's state. The
// builder is exported for its test; the query is exported so the test can
// hold it to skinVoters()'s answer, which is the definition it must match.

import type { DatabaseSync } from 'node:sqlite'
import type { AnswerVoters } from '../answer'
import { hasEnoughVoters, isConfident } from '../answer'
import type { SettleHubState, SettleRow } from '../types'
import { allCatalogSkins, ensureCatalog } from './catalog'
import { getDb } from './db'

export interface HubSkin {
  id: string
  name: string
  championId: string
  championName: string
  // Null until the skin has fought (no rating row, or battles = 0).
  rating: number | null
  uncertainty: number | null
  battles: number
}

// Distinct people behind every skin, split by trust tier, in one pass: the
// same UNION skinVoters() runs for one skin, grouped for all of them. Same
// LEFT JOIN, same "tier now" reading of logto_sub, so a converting guest
// upgrades here the moment they do there.
export function allSkinVoters(db: DatabaseSync): Map<string, AnswerVoters> {
  const rows = db
    .prepare(
      `WITH v AS (
         SELECT DISTINCT json_extract(e.payload, '$.winnerId') AS skin_id, e.user_id AS uid
           FROM game_events e
          WHERE e.game = 'quick-battle' AND e.type = 'battle_voted'
         UNION
         SELECT DISTINCT json_extract(e.payload, '$.loserId') AS skin_id, e.user_id AS uid
           FROM game_events e
          WHERE e.game = 'quick-battle' AND e.type = 'battle_voted'
         UNION
         SELECT DISTINCT placed.value AS skin_id, e.user_id AS uid
           FROM game_events e,
                json_each(json_extract(e.payload, '$.tiers')) AS tier,
                json_each(tier.value) AS placed
          WHERE e.game = 'tier-list' AND e.type = 'tier_submitted'
       )
       SELECT v.skin_id AS skinId,
              SUM(u.logto_sub IS NOT NULL) AS members,
              SUM(u.logto_sub IS NULL) AS guests
         FROM v
         LEFT JOIN game_users u ON u.id = v.uid
        GROUP BY v.skin_id`,
    )
    .all() as unknown as { skinId: string; members: number; guests: number }[]
  return new Map(
    rows.map((r) => [String(r.skinId), { members: r.members, guests: r.guests }]),
  )
}

// Every champion's row, from the catalog order in. Pure: the same skins and
// the same head counts always produce the same list, which is what lets the
// hub, the champion page and the battle banner agree on a champion's state.
export function buildSettleRows(
  skins: HubSkin[],
  voters: Map<string, AnswerVoters>,
): SettleRow[] {
  const byChampion = new Map<string, HubSkin[]>()
  for (const s of skins) {
    const list = byChampion.get(s.championId) ?? []
    list.push(s)
    byChampion.set(s.championId, list)
  }
  const rows: SettleRow[] = []
  for (const [championId, wardrobe] of byChampion) {
    const rated = wardrobe.filter((s) => s.battles > 0 && s.rating !== null)
    const base = {
      championId,
      championName: wardrobe[0].championName,
      slug: championId.toLowerCase(),
      total: wardrobe.length,
      rated: rated.length,
    }
    if (rated.length === 0) {
      rows.push({ ...base, state: 'empty', missing: null, leader: null })
      continue
    }
    const leader = rated.reduce((a, b) => (b.rating! > a.rating! ? b : a))
    // Rounded to the integer the pages print - the band a reader can see is
    // the one that decides, exactly as rankings.ts hands answerBlock.
    const band = Math.round(leader.uncertainty ?? 0)
    const heads = voters.get(leader.id) ?? { members: 0, guests: 0 }
    const missing = !isConfident(band)
      ? 'band'
      : !hasEnoughVoters(heads)
        ? 'voters'
        : null
    rows.push({
      ...base,
      state: missing ? 'provisional' : 'settled',
      missing,
      leader: {
        name: leader.name,
        band,
        battles: leader.battles,
        voters: heads.members + heads.guests,
      },
    })
  }
  return rows
}

// The hub's order: rankings a head count away from settled first (the band
// is already in), then the rest of the provisional ones by band, tightest
// first, then the untouched wardrobes, largest first. Settled rankings are
// left out - they are counted in the header, not asked for.
export function needsYou(rows: SettleRow[]): SettleRow[] {
  const rank = (r: SettleRow): number =>
    r.missing === 'voters' ? 0 : r.state === 'provisional' ? 1 : 2
  return rows
    .filter((r) => r.state !== 'settled')
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.leader?.band ?? Infinity) - (b.leader?.band ?? Infinity) ||
        b.total - a.total ||
        a.championName.localeCompare(b.championName),
    )
}

export async function settleHubState(): Promise<SettleHubState> {
  const db = getDb()
  await ensureCatalog(db)
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
  const skins: HubSkin[] = allCatalogSkins(db).map((s) => {
    const r = ratings.get(s.id)
    return {
      id: s.id,
      name: s.name,
      championId: s.championId,
      championName: s.championName,
      rating: r?.rating ?? null,
      uncertainty: r?.uncertainty ?? null,
      battles: r?.battles ?? 0,
    }
  })
  const rows = buildSettleRows(skins, allSkinVoters(db))
  const count = (state: SettleRow['state']) =>
    rows.filter((r) => r.state === state).length
  return {
    rows: needsYou(rows),
    counts: {
      settled: count('settled'),
      provisional: count('provisional'),
      empty: count('empty'),
      champions: rows.length,
    },
  }
}
