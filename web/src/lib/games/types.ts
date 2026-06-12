// Shared (client-safe) types for the games framework. Server-only logic
// lives under ./server — never import that from components.

export type GameId = 'splashdle' | 'price-check' | 'chroma-vision'

export type DailyStatus = 'not_started' | 'in_progress' | 'won' | 'lost'

export interface StreakInfo {
  current: number
  best: number
}

export interface SplashdleGuess {
  skinId: string
  name: string
  championId: string
  championName: string
  // Wrong skin, right champion — the "warm" hint (🟨 in the share grid).
  championMatch: boolean
  correct: boolean
}

export interface SplashdleAnswer {
  skinId: string
  name: string
  championId: string
  championName: string
  splashUrl: string
}

export interface SplashdleState {
  date: string // YYYY-MM-DD (UTC) — the puzzle resets at midnight UTC
  puzzleNumber: number
  maxGuesses: number
  status: 'in_progress' | 'won' | 'lost'
  guesses: SplashdleGuess[]
  // While playing: a base64 data URL of the server-cropped splash (the full
  // image — and its answer-revealing URL — never reaches the client until the
  // game is over). After completion: the real full splash URL.
  image: string
  zoomLevel: number
  totalLevels: number
  streak: StreakInfo
  // Present only when status is 'won' or 'lost':
  answer?: SplashdleAnswer
  shareText?: string
  // Echoed so the client can keep a localStorage backup of the guest cookie.
  guestToken: string
}

// Chroma Vision shares Splashdle's state shape exactly — same six-guess
// board, same champion-match hint; `image` is the color mosaic instead of a
// crop and `zoomLevel` is the mosaic resolution level.
export type ChromaVisionState = SplashdleState

export interface GuessOption {
  skinId: string
  name: string
  championId: string
  championName: string
}

export interface HubGame {
  id: GameId
  status: DailyStatus
  guessesUsed: number
  maxGuesses: number
  // Price Check: exact hits so far (its win condition is score, not guesses).
  score?: number
  streak: StreakInfo
}

export interface DailyHubState {
  date: string
  games: HubGame[]
  // Quick Battle is endless, not a daily — its hub card shows volume, not a
  // checklist slot.
  quickBattle: {
    userBattles: number
    communityBattles: number
  }
  // The Mirror's hub card shows how much of a reflection exists yet.
  mirror: {
    skinsRated: number
  }
  // "New this patch" strip — skins released in the last ~3 weeks plus
  // Upcoming ones already in the live catalog. Empty outside drop windows;
  // the section hides itself.
  newSkins: {
    skinId: string
    slug: string
    name: string
    championName: string
    splashUrl: string
    release: string | null // null = Upcoming
    upcoming: boolean
  }[]
  guestToken: string
}

// ─── Quick Battle ───────────────────────────────────────────────────────────

export interface BattleSkin {
  skinId: string
  name: string
  championId: string
  championName: string
  splashUrl: string
}

// Ratings are deliberately absent pre-pick (they'd bias the vote); they
// arrive in the feedback. `token` is the server-signed claim that this exact
// matchup was dealt by the matchmaker.
export interface BattlePair {
  token: string
  a: BattleSkin
  b: BattleSkin
}

export interface BattleStats {
  total: number // this user's lifetime battles
  today: number
  community: number // all battles ever fought, by everyone
  tier: 'guest' | 'member'
}

// What a pick answers back with (principle 1): the winner's rating movement
// and new rank always; "X% agree" once the matchup has a real sample.
export interface BattleFeedback {
  winnerSkinId: string
  winnerName: string
  loserName: string
  delta: number
  rating: number
  uncertainty: number
  battles: number
  rank: number
  rankBefore: number | null // null = this was the skin's placement battle
  agreementPct: number | null // null until the matchup has enough votes
  pairVotes: number
}

export interface RefitSummary {
  skins: number
  events: number
  iterations: number
  tookMs: number
}

export interface QuickBattleState {
  pair: BattlePair
  next: BattlePair // preloaded so the first pick has zero wait
  stats: BattleStats
  guestToken: string
  refit?: RefitSummary // present only when a manual refit was triggered
}

export interface BattleVoteResult {
  feedback: BattleFeedback
  nextPair: BattlePair
  stats: BattleStats
  guestToken: string
}

// ─── Price Check ────────────────────────────────────────────────────────────

// An answered round. Facts only ship AFTER the guess — the unanswered
// round's price never reaches the client.
export interface PriceRoundResult {
  skinId: string
  name: string
  championName: string
  splashUrl: string
  guess: number
  actual: number
  correct: boolean
  oneOff: boolean // adjacent tier — the 🟨 in the share grid
  legacy: boolean // fun fact: vaulted, not even buyable anymore
}

export interface PriceCheckState {
  date: string
  puzzleNumber: number
  status: 'in_progress' | 'won' | 'lost'
  tiers: number[]
  totalRounds: number
  winScore: number
  score: number // exact hits so far
  results: PriceRoundResult[] // answered rounds, in order
  // The round being played (price withheld); null once finished.
  current: {
    round: number // 1-based
    skinId: string
    name: string
    championName: string
    splashUrl: string
  } | null
  streak: StreakInfo
  shareText?: string
  guestToken: string
}

// ─── Leaderboards ───────────────────────────────────────────────────────────

export interface StreakBoardEntry {
  rank: number
  name: string
  current: number
  best: number
}

export interface SolveBoardEntry {
  rank: number
  name: string
  guesses: number
}

export interface VolumeBoardEntry {
  rank: number
  name: string
  battles: number
}

export interface LeaderboardsState {
  date: string
  memberCount: number
  streakBoards: { game: GameId; entries: StreakBoardEntry[] }[]
  todayBoards: { game: 'splashdle' | 'chroma-vision'; entries: SolveBoardEntry[] }[]
  battleBoards: { period: 'week' | 'all'; entries: VolumeBoardEntry[] }[]
}

// ─── Ranking slices ─────────────────────────────────────────────────────────

export interface RankingRow {
  rank: number
  skinId: string
  slug: string
  name: string
  championName: string
  splashUrl: string
  rating: number
  uncertainty: number
  battles: number
  cost: number | null
}

export interface RankingsState {
  slice: string
  title: string
  subtitle: string
  rows: RankingRow[] // rated skins, rating desc, capped
  ratedCount: number
  totalCount: number
  medianBattles: number
  // True until the slice has real sample depth — rendered as the
  // "Early Rankings — still calibrating" banner (thin data is a call to
  // action, not an embarrassment).
  calibrating: boolean
}

export interface SliceLink {
  slice: string
  label: string
  count: number
}

export interface RankingsIndex {
  prices: SliceLink[]
  years: SliceLink[]
  lines: SliceLink[]
  champions: SliceLink[]
}

// ─── Skin pages (stable URLs) ───────────────────────────────────────────────

export interface SkinPageState {
  skinId: string
  slug: string // canonical — loaders redirect non-canonical spellings here
  name: string
  championId: string
  championName: string
  splashUrl: string
  facts: {
    cost: number | null
    rarity: string | null
    availability: string | null
    sets: string[]
    release: string | null
  } | null
  community: {
    rating: number
    uncertainty: number
    battles: number
    wins: number
    rank: number
    calibrated: boolean // false = "Early ranking — needs more votes"
  } | null // null = never battled
  ratedTotal: number
  personal: {
    rating: number
    battles: number
    gap: number | null // vs community; null when the skin is unranked
  } | null
  guestToken: string
}

// ─── Insights: the Skin Drought Index ───────────────────────────────────────

export interface DroughtRow {
  rank: number
  championId: string
  championName: string
  days: number
  lastSkinId: string
  lastSkinSlug: string
  lastSkinName: string
  lastSkinSplashUrl: string
  lastSkinDate: string // YYYY-MM-DD
  skinCount: number
}

export interface DroughtState {
  date: string // UTC day the numbers are relative to
  rows: DroughtRow[] // drought days desc
  // Champions with no dated skins (typically brand-new — the facts snapshot
  // hasn't caught up). Listed honestly rather than silently dropped.
  undated: { championId: string; championName: string; skinCount: number }[]
  stats: {
    champions: number
    longestDays: number
    overTwoYears: number // champions with 730+ day droughts
    averageDays: number
  }
}

// ─── The Mirror ─────────────────────────────────────────────────────────────

export type TierName = 'S' | 'A' | 'B' | 'C' | 'D'

export interface MirrorSkin {
  skinId: string
  slug: string // stable URL: /skins/<slug>
  name: string
  championId: string
  championName: string
  splashUrl: string
  rating: number // personal rating, rounded
  battles: number // this user's battles involving the skin
}

export interface MirrorTier {
  tier: TierName
  skins: MirrorSkin[] // rating desc
}

// A take only qualifies once both sides have a real sample (the thresholds
// live in server/mirror.ts) — otherwise "contrarian" is just noise.
export interface ContrarianTake {
  skinId: string
  slug: string
  name: string
  championName: string
  splashUrl: string
  personal: number
  community: number
  communityRank: number
  gap: number // personal − community; positive = you're hotter than the room
  personalBattles: number
  communityBattles: number
}

// Taste profile entry: a skin line ("you over-index on Coven") or, where
// line data is thin, a champion. Both can appear — entries are labeled.
export interface TasteEntry {
  kind: 'line' | 'champion'
  id: string
  name: string
  delta: number // group's avg personal rating − your overall avg, rounded
  skinsRated: number
}

export interface ChampionCompletion {
  championId: string
  championName: string
  rated: number
  total: number
}

export interface MirrorState {
  guestToken: string
  tier: 'guest' | 'member'
  totalBattles: number
  skinsRated: number
  catalogTotal: number
  championsTouched: number
  championsTotal: number
  tiers: MirrorTier[] // empty until the first battle (the page shows a preview)
  contrarian: ContrarianTake[] // |gap| desc
  tasteOver: TasteEntry[]
  tasteUnder: TasteEntry[]
  completion: ChampionCompletion[] // champions touched, most-rated first
  completionMore: number // touched champions beyond the list cap
}
