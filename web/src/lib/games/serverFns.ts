// RPC surface for the games framework. Handlers dynamic-import the server
// modules so nothing under ./server (node:sqlite, jimp, fs) can leak into
// the client bundle.
//
// Migration note: when game logic moves to the Go API, these functions keep
// their signatures and become thin fetch wrappers - components don't change.

import { createServerFn } from '@tanstack/react-start'
import type {
  BattleMode,
  BattleUndoResult,
  BattleVoteResult,
  ChromaVisionState,
  DailyHubState,
  DroughtState,
  HomeState,
  GuessOption,
  LeaderboardsState,
  MirrorState,
  PriceCheckState,
  QuickBattleState,
  RankingsIndex,
  RankingsState,
  RoadmapState,
  SkinPageState,
  SplashdleState,
  SharedTierListState,
  TierFeedState,
  TierListResult,
  TierListState,
  TierName,
  TierScopeCatalog,
} from './types'
import type { ShareMode } from './share'

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

// The guessable catalog for autocomplete - shared by Splashdle and Chroma
// Vision (both guess across the full skin pool).
export const fetchSplashdleOptions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GuessOption[]> => {
    const { splashdleOptions } = await import('./server/splashdle')
    return splashdleOptions()
  },
)

export const fetchChromaVision = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput) => d)
  .handler(async ({ data }): Promise<ChromaVisionState> => {
    const { chromaVisionState } = await import('./server/chromavision')
    return chromaVisionState(data.restoreToken)
  })

export const submitChromaGuess = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { skinId: string }) => d)
  .handler(async ({ data }): Promise<ChromaVisionState> => {
    const { submitChromaGuess: submit } = await import('./server/chromavision')
    return submit(data.skinId, data.restoreToken)
  })

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

// Leaderboards are anonymous reads - guests can see the boards (they just
// can't occupy them).
export const fetchLeaderboards = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LeaderboardsState> => {
    const { leaderboardsState } = await import('./server/leaderboards')
    return leaderboardsState()
  },
)

// Ranking slices are fully anonymous derived data, like the Drought Index.
// `offset` pages through slices deeper than one page of rows.
export const fetchRankings = createServerFn({ method: 'POST' })
  .inputValidator((d: { slice: string; offset?: number }) => d)
  .handler(async ({ data }): Promise<RankingsState | null> => {
    const { rankingsState } = await import('./server/rankings')
    return rankingsState(data.slice, data.offset ?? 0)
  })

export const fetchRankingsIndex = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RankingsIndex> => {
    const { rankingsIndex } = await import('./server/rankings')
    return rankingsIndex()
  },
)

// Skin pages are read-only (peekUser - viewing never mints a user). Returns
// null for unknown slugs/ids; the route turns that into a 404.
export const fetchSkinPage = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { slug: string }) => d)
  .handler(async ({ data }): Promise<SkinPageState | null> => {
    const { skinPageState } = await import('./server/skinpage')
    return skinPageState(data.slug, data.restoreToken)
  })

// Home page state: the daily hero slide set + live community numbers.
// Anonymous like the Drought Index - personalization happens client-side
// against the Go API once the visitor is signed in.
export const fetchHome = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HomeState> => {
    const { homeState } = await import('./server/home')
    return homeState()
  },
)

// The Drought Index is fully anonymous - no guest token, nothing
// personalized, pure derived data over the catalog + facts snapshot.
export const fetchDrought = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DroughtState> => {
    const { droughtIndex } = await import('./server/insights')
    return droughtIndex()
  },
)

// Roadmap totals are anonymous derived data: community-wide battle volume,
// rating coverage, and star/ban totals for the milestone meters.
export const fetchRoadmap = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RoadmapState> => {
    const { roadmapState } = await import('./server/roadmap')
    return roadmapState()
  },
)

// Quick Battle state: the current pair plus a preloaded next pair. `refit`
// manually triggers the Bradley-Terry refit (guarded by GAMES_ADMIN_SECRET
// when set) - reachable via /battle?refit=… for cron/curl.
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
    (
      d: GuestInput & {
        pairToken: string
        winnerId: string
        recent?: string[]
        // 'champion' = king-of-the-hill: the next pair is anchored on the
        // winner. Omitted/`shuffle` keeps today's fresh-pair behavior.
        mode?: BattleMode
      },
    ) => d,
  )
  .handler(async ({ data }): Promise<BattleVoteResult> => {
    const { submitBattleVote: submit } = await import('./server/quickbattle')
    return submit(
      data.pairToken,
      data.winnerId,
      data.recent,
      data.restoreToken,
      data.mode,
    )
  })

// Undo the player's most recent pick: reverses the rating updates and returns
// the exact matchup to decide again. Null when there's nothing to take back.
export const submitBattleUndo = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput) => d)
  .handler(async ({ data }): Promise<BattleUndoResult | null> => {
    const { undoLastVote } = await import('./server/quickbattle')
    return undoLastVote(data.restoreToken)
  })

// Tier List: serve the daily (or a coverage-picked) board to rank — or, when
// boardId is given, the exact scope the player picked in "make your own".
export const fetchTierList = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { boardId?: string }) => d)
  .handler(async ({ data }): Promise<TierListState> => {
    const { tierListState } = await import('./server/tierlist')
    return tierListState(data.restoreToken, data.boardId)
  })

// The "make your own" picker options, grouped by axis (champion/line/year/
// price/rarity). Anonymous catalog data — no guest token needed.
export const fetchTierScopes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TierScopeCatalog> => {
    const { tierScopes } = await import('./server/tierlist')
    return tierScopes()
  },
)

// The community tier-list browser: recent submissions, newest first, paged.
// Anonymous derived data.
export const fetchTierFeed = createServerFn({ method: 'POST' })
  .inputValidator((d: { offset?: number; axis?: string; boardId?: string }) => d)
  .handler(async ({ data }): Promise<TierFeedState> => {
    const { tierListFeed } = await import('./server/tierlist')
    return tierListFeed(data.offset ?? 0, data.axis, data.boardId)
  })

// Submit a tier list: its cross-tier comparisons feed the community ratings,
// and the result carries the post-submit "how you compare" rows + a next board.
export const submitTierList = createServerFn({ method: 'POST' })
  .inputValidator(
    (
      d: GuestInput & {
        boardToken: string
        tiers: Partial<Record<TierName, string[]>>
        recent?: string[]
      },
    ) => d,
  )
  .handler(async ({ data }): Promise<TierListResult> => {
    const { submitTierList: submit } = await import('./server/tierlist')
    return submit(data.boardToken, data.tiers, data.recent, data.restoreToken)
  })

// Mint a short share link for a tier list: stores the payload, returns an id
// the share URL and image endpoint resolve by (keeps links short).
export const createTierShare = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: {
      boardId: string
      tiers?: Partial<Record<TierName, string[]>> | null
      name?: string
      mode: ShareMode
    }) => d,
  )
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createTierShare: create } = await import('./server/tierlist')
    return create(data)
  })

// Resolve a shared tier-list link (?s=<id>) for the recipient: the board to
// (re)rank, the reveal mode, and the sharer's ranking when it's shared.
export const fetchSharedTierList = createServerFn({ method: 'POST' })
  .inputValidator((d: GuestInput & { id: string }) => d)
  .handler(async ({ data }): Promise<SharedTierListState> => {
    const { sharedTierListState } = await import('./server/tierlist')
    return sharedTierListState(data.id, data.restoreToken)
  })
