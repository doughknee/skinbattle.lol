// Player-consensus counts (server-only): "N others also guessed this".
//
// Derived entirely from the append-only guess_submitted events, so the
// numbers are always real and always live as of the read. Backed by
// idx_game_events_guess (game, type, puzzle_date, skinId) - see db.ts.
//
// Each (user, skin, puzzle) produces at most one guess_submitted row (a
// duplicate guess is rejected before it's recorded), so COUNT(*) == number of
// distinct players. Counts INCLUDE the asking player; callers subtract one for
// "others".

import type { DatabaseSync } from 'node:sqlite'

// For Splashdle / Chroma Vision: how many players guessed each of these skins
// for today's puzzle. Keyed by skin id; every requested id is present (>= 1,
// since the caller only asks about skins the player themselves guessed).
export function skinGuessCounts(
  db: DatabaseSync,
  game: string,
  date: string,
  skinIds: string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  if (skinIds.length === 0) return out
  const placeholders = skinIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT json_extract(payload, '$.skinId') AS sid, COUNT(*) AS c
       FROM game_events
       WHERE game = ? AND type = 'guess_submitted' AND puzzle_date = ?
         AND json_extract(payload, '$.skinId') IN (${placeholders})
       GROUP BY sid`,
    )
    .all(game, date, ...skinIds) as unknown as { sid: string; c: number }[]
  for (const id of skinIds) out[id] = 0
  for (const r of rows) out[r.sid] = r.c
  return out
}

// For Price Point: how many players guessed this exact tier for this skin
// today (incl. the asking player).
export function tierGuessCount(
  db: DatabaseSync,
  game: string,
  date: string,
  skinId: string,
  tier: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM game_events
       WHERE game = ? AND type = 'guess_submitted' AND puzzle_date = ?
         AND json_extract(payload, '$.skinId') = ?
         AND json_extract(payload, '$.guess') = ?`,
    )
    .get(game, date, skinId, tier) as unknown as { c: number }
  return row.c
}
