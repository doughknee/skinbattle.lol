// Leaderboards (server-only): the Phase 0 boards, members-only by design -
// guests can see the boards but never occupy them (design doc permission
// split: named placement is a scarce, public, social surface). Display
// names come from the verified Logto ID token captured at attach time.

import type { DatabaseSync } from 'node:sqlite'
import type { GameId, LeaderboardsState } from '../types'
import { getDb } from './db'
import { puzzleDay } from './daily'

const TOP = 10

interface Member {
  id: string
  name: string
}

// Named members only: an attached account without a captured username gets
// a neutral placeholder rather than exposing any identifier.
function members(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT id, username FROM game_users
       WHERE logto_sub IS NOT NULL AND merged_into IS NULL`,
    )
    .all() as unknown as { id: string; username: string | null }[]
  return new Map(rows.map((r) => [r.id, r.username ?? 'Anonymous member']))
}

export async function leaderboardsState(): Promise<LeaderboardsState> {
  const db = getDb()
  const date = puzzleDay()
  const named = members(db)
  const ids = [...named.keys()]

  const streakBoards = (['splashdle', 'price-check', 'chroma-vision'] as GameId[]).map(
    (game) => {
      const rows = (
        db
          .prepare(
            `SELECT user_id, current_streak, best_streak FROM streaks
             WHERE game = ? AND best_streak > 0
             ORDER BY current_streak DESC, best_streak DESC`,
          )
          .all(game) as unknown as {
          user_id: string
          current_streak: number
          best_streak: number
        }[]
      )
        .filter((r) => named.has(r.user_id))
        .slice(0, TOP)
      return {
        game,
        entries: rows.map((r, i) => ({
          rank: i + 1,
          name: named.get(r.user_id)!,
          current: r.current_streak,
          best: r.best_streak,
        })),
      }
    },
  )

  const todayBoards = (['splashdle', 'chroma-vision'] as const).map((game) => {
    const rows = (
      db
        .prepare(
          `SELECT user_id, guesses, completed_at FROM daily_results
           WHERE game = ? AND puzzle_date = ? AND status = 'won'
           ORDER BY json_array_length(guesses) ASC, completed_at ASC`,
        )
        .all(game, date) as unknown as {
        user_id: string
        guesses: string
        completed_at: string
      }[]
    )
      .filter((r) => named.has(r.user_id))
      .slice(0, TOP)
    return {
      game,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: named.get(r.user_id)!,
        guesses: (JSON.parse(r.guesses) as unknown[]).length,
      })),
    }
  })

  // Battle volume: all-time and the trailing 7 days. The events table is
  // the truth; member set is small, so filter in SQL with a join-less IN.
  const volumeBoard = (sinceIso: string | null) => {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT user_id, COUNT(*) AS battles FROM game_events
         WHERE game = 'quick-battle' AND type = 'battle_voted'
           AND user_id IN (${placeholders})
           ${sinceIso ? 'AND created_at >= ?' : ''}
         GROUP BY user_id ORDER BY battles DESC LIMIT ${TOP}`,
      )
      .all(...ids, ...(sinceIso ? [sinceIso] : [])) as unknown as {
      user_id: string
      battles: number
    }[]
    return rows.map((r, i) => ({
      rank: i + 1,
      name: named.get(r.user_id)!,
      battles: r.battles,
    }))
  }
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  return {
    date,
    memberCount: named.size,
    streakBoards,
    todayBoards,
    battleBoards: [
      { period: 'week', entries: volumeBoard(weekAgo) },
      { period: 'all', entries: volumeBoard(null) },
    ],
  }
}
