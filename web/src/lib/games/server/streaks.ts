// Per-user per-game streak tracking. A streak counts consecutive UTC days
// with a WIN; a loss resets it to 0 but still marks the day as played.
// best_streak and freeze_tokens are in the schema from day one (design
// principle 7) — freeze redemption (bridging a missed day) ships later.

import type { DatabaseSync } from 'node:sqlite'

export interface StreakRow {
  current: number
  best: number
  freezeTokens: number
  lastResultDate: string | null
}

export function getStreak(
  db: DatabaseSync,
  userId: string,
  game: string,
): StreakRow {
  const row = db
    .prepare(
      `SELECT current_streak AS current, best_streak AS best,
              freeze_tokens AS freezeTokens, last_result_date AS lastResultDate
       FROM streaks WHERE user_id = ? AND game = ?`,
    )
    .get(userId, game) as unknown as StreakRow | undefined
  return row ?? { current: 0, best: 0, freezeTokens: 0, lastResultDate: null }
}

function isNextDay(prev: string, cur: string): boolean {
  return (
    Date.parse(`${cur}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) ===
    86_400_000
  )
}

// Record a completed daily and return the updated streak. Idempotent per
// (user, game, date) — replays of the same completion are no-ops.
export function recordCompletion(
  db: DatabaseSync,
  userId: string,
  game: string,
  date: string,
  won: boolean,
): StreakRow {
  const s = getStreak(db, userId, game)
  if (s.lastResultDate === date) return s

  let current = 0
  if (won) {
    const continues =
      s.current > 0 && s.lastResultDate !== null && isNextDay(s.lastResultDate, date)
    current = continues ? s.current + 1 : 1
  }
  const best = Math.max(s.best, current)

  db.prepare(
    `INSERT INTO streaks (user_id, game, current_streak, best_streak, last_result_date, freeze_tokens)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, game) DO UPDATE SET
       current_streak = excluded.current_streak,
       best_streak = excluded.best_streak,
       last_result_date = excluded.last_result_date`,
  ).run(userId, game, current, best, date, s.freezeTokens)

  return { current, best, freezeTokens: s.freezeTokens, lastResultDate: date }
}
