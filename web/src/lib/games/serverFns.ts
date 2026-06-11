// RPC surface for the games framework. Handlers dynamic-import the server
// modules so nothing under ./server (node:sqlite, jimp, fs) can leak into
// the client bundle.
//
// Migration note: when game logic moves to the Go API, these functions keep
// their signatures and become thin fetch wrappers — components don't change.

import { createServerFn } from '@tanstack/react-start'
import type {
  BattleVoteResult,
  DailyHubState,
  GuessOption,
  QuickBattleState,
  SplashdleState,
} from './types'

// Every game call may carry the localStorage backup of the guest token so a
// cleared cookie can be restored without losing progress (see server/guests.ts).
interface GuestInput {
  restoreToken?: string | null
}

export const fetchDailyHub = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput) => d)
  .handler(async ({ data }): Promise<DailyHubState> => {
    const { dailyHub } = await import('./server/splashdle')
    return dailyHub(data.restoreToken)
  })

export const fetchSplashdleState = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput) => d)
  .handler(async ({ data }): Promise<SplashdleState> => {
    const { splashdleState } = await import('./server/splashdle')
    return splashdleState(data.restoreToken)
  })

export const submitSplashdleGuess = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { skinId: string }) => d)
  .handler(async ({ data }): Promise<SplashdleState> => {
    const { submitSplashdleGuess: submit } = await import('./server/splashdle')
    return submit(data.skinId, data.restoreToken)
  })

export const fetchSplashdleOptions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GuessOption[]> => {
    const { splashdleOptions } = await import('./server/splashdle')
    return splashdleOptions()
  },
)

// Quick Battle state: the current pair plus a preloaded next pair. `refit`
// manually triggers the Bradley-Terry refit (guarded by GAMES_ADMIN_SECRET
// when set) — reachable via /games/quick-battle?refit=… for cron/curl.
export const fetchQuickBattle = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { refit?: string }) => d)
  .handler(async ({ data }): Promise<QuickBattleState> => {
    const { quickBattleState } = await import('./server/quickbattle')
    return quickBattleState(data.restoreToken, data.refit)
  })

export const submitBattleVote = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: GuestInput & { pairToken: string; winnerId: string; recent?: string[] }) => d,
  )
  .handler(async ({ data }): Promise<BattleVoteResult> => {
    const { submitBattleVote: submit } = await import('./server/quickbattle')
    return submit(data.pairToken, data.winnerId, data.recent, data.restoreToken)
  })
