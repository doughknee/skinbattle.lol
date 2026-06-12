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
  DroughtState,
  GuessOption,
  MirrorState,
  PriceCheckState,
  QuickBattleState,
  RankingsIndex,
  RankingsState,
  SkinPageState,
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

export const fetchPriceCheck = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput) => d)
  .handler(async ({ data }): Promise<PriceCheckState> => {
    const { priceCheckState } = await import('./server/pricecheck')
    return priceCheckState(data.restoreToken)
  })

export const submitPriceGuess = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { tier: number }) => d)
  .handler(async ({ data }): Promise<PriceCheckState> => {
    const { submitPriceGuess: submit } = await import('./server/pricecheck')
    return submit(data.tier, data.restoreToken)
  })

// Ranking slices are fully anonymous derived data, like the Drought Index.
export const fetchRankings = createServerFn({ method: 'POST' })
  .inputValidator((d: { slice: string }) => d)
  .handler(async ({ data }): Promise<RankingsState | null> => {
    const { rankingsState } = await import('./server/rankings')
    return rankingsState(data.slice)
  })

export const fetchRankingsIndex = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RankingsIndex> => {
    const { rankingsIndex } = await import('./server/rankings')
    return rankingsIndex()
  },
)

// Skin pages are read-only (peekUser — viewing never mints a user). Returns
// null for unknown slugs/ids; the route turns that into a 404.
export const fetchSkinPage = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { slug: string }) => d)
  .handler(async ({ data }): Promise<SkinPageState | null> => {
    const { skinPageState } = await import('./server/skinpage')
    return skinPageState(data.slug, data.restoreToken)
  })

// The Drought Index is fully anonymous — no guest token, nothing
// personalized, pure derived data over the catalog + facts snapshot.
export const fetchDrought = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DroughtState> => {
    const { droughtIndex } = await import('./server/insights')
    return droughtIndex()
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

// The Mirror is strictly a read surface: viewing it never mints a user and
// never writes a row.
export const fetchMirror = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput) => d)
  .handler(async ({ data }): Promise<MirrorState> => {
    const { mirrorState } = await import('./server/mirror')
    return mirrorState(data.restoreToken)
  })

export const submitBattleVote = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: GuestInput & { pairToken: string; winnerId: string; recent?: string[] }) => d,
  )
  .handler(async ({ data }): Promise<BattleVoteResult> => {
    const { submitBattleVote: submit } = await import('./server/quickbattle')
    return submit(data.pairToken, data.winnerId, data.recent, data.restoreToken)
  })
