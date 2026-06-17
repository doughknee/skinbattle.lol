// Shared (client-safe) types for the games framework. Server-only logic
// lives under ./server - never import that from components.

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
  // Wrong skin, right champion - the "warm" hint (🟨 in the share grid).
  championMatch: boolean
  // Wrong champion, but shares a skin line with the answer (same theme, and
  // so a shared palette) - the secondary "warm" hint (🟦 in the share grid).
  // Suppressed when championMatch is true: the right champion is the stronger
  // tell, so a guess is shown as one or the other, never both.
  lineMatch: boolean
  // The shared skin line to name in the hint ("Coven"); set only on lineMatch.
  lineName?: string
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
  date: string // YYYY-MM-DD (UTC) - the puzzle resets at midnight UTC
  puzzleNumber: number
  maxGuesses: number
  status: 'in_progress' | 'won' | 'lost'
  guesses: SplashdleGuess[]
  // skinId -> how many players (incl. you) have guessed that skin for today's
  // puzzle. Live as of this read; powers "N others also guessed this".
  guessCounts: Record<string, number>
  // While playing: a base64 data URL of the server-cropped splash (the full
  // image - and its answer-revealing URL - never reaches the client until the
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

// Chroma Vision shares Splashdle's state shape exactly - same six-guess
// board, same champion-match hint; `image` is the color mosaic instead of a
// crop and `zoomLevel` is the mosaic resolution level.
export type ChromaVisionState = SplashdleState

export interface GuessOption {
  skinId: string
  name: string
  championId: string
  championName: string
  // Per-skin tile art (Community Dragon) shown in the autocomplete row.
  tileUrl: string
  // Skin line(s) this skin belongs to, so the guess box finds it by theme
  // ("Bewitching") the same way the command palette does.
  sets: string[]
}

export interface HubGame {
  id: GameId
  status: DailyStatus
  guessesUsed: number
  maxGuesses: number
  // Price Point: exact hits so far (its win condition is score, not guesses).
  score?: number
  streak: StreakInfo
  // True only when the current streak is genuinely still running into today
  // (last result was today or yesterday). Gates the honest "keep your streak
  // alive" nudge so it can never show for a stale/dead streak.
  streakAlive: boolean
}

export interface DailyHubState {
  date: string
  games: HubGame[]
  // Quick Battle is endless, not a daily - its hub card shows volume, not a
  // checklist slot.
  quickBattle: {
    userBattles: number
    communityBattles: number
  }
  // The Mirror's hub card shows how much of a reflection exists yet.
  mirror: {
    skinsRated: number
  }
  guestToken: string
}

// ─── Quick Battle ───────────────────────────────────────────────────────────

// How the loop deals pairs. 'shuffle': a fresh matchmade pair every round
// (the default). 'champion': king-of-the-hill — the winner stays as the
// reigning champion and only the challenger is replaced. The mode only changes
// which pair is dealt NEXT; every pick is still an ordinary, server-minted,
// signed vote, so the ranking is identical across modes.
export type BattleMode = 'shuffle' | 'champion'

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
  pairVotes: number // total votes ever cast on this exact matchup (incl. yours)
  pairWinnerVotes: number // of those, how many picked your winner (incl. yours)
  // Located standing - the winner's place in the whole rated field plus its
  // named neighbours. The wordless "needle" the rest of the line narrates:
  // felt weight from a real, named position, not from faked per-pick motion.
  ratedCount: number // the denominator for "#789 of 1,420" (0 if unknown)
  neighborAbove: RankNeighbor | null // the skin one rung higher, or null at #1
  neighborBelow: RankNeighbor | null // the skin one rung lower, or null at last
}

export interface RankNeighbor {
  name: string
  rank: number
}

export interface RefitSummary {
  skins: number
  events: number
  iterations: number
  tookMs: number
  // Skins flagged for vote concentration (one voter dominating their wins).
  flagged?: number
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

export interface BattleUndoResult {
  // The exact matchup of the undone pick, freshly tokenised to decide again.
  pair: BattlePair
  stats: BattleStats
}

// ─── Tier List ──────────────────────────────────────────────────────────────

export interface TierListSkin {
  skinId: string
  name: string
  championId: string
  championName: string
  splashUrl: string
}

// A dealt board: which skins to rank plus the signed claim that the server
// dealt exactly these. Ratings are absent (they would bias placement).
export interface TierBoard {
  token: string
  boardId: string // e.g. 'champion:Lux'
  boardType: string // 'champion' (MVP); later 'line' | 'year' | …
  title: string
  subtitle: string
  skins: TierListSkin[] // shuffled
}

export interface TierListStats {
  total: number // this user's lifetime submissions
  community: number // all tier lists ever submitted
  tier: 'guest' | 'member'
}

export interface TierListState {
  board: TierBoard
  daily: boolean // true when this is the global daily board
  stats: TierListStats
  guestToken: string
  // Present when the player already ranked this exact board (and it's still
  // current): their saved tiers + a fresh comparison, so the page shows the
  // result instead of a blank board to re-rank.
  submitted?: SubmittedTierList | null
}

// A restored, already-submitted tier list: the saved placement plus a freshly
// recomputed comparison (community tiers, agreement, hot takes).
export interface SubmittedTierList {
  tiers: Partial<Record<TierName, string[]>>
  result: TierListResult
}

// One row in the community tier-list browser: who ranked what, their S-tier
// picks, and when.
export interface TierFeedRow {
  boardId: string
  boardTitle: string // e.g. "Lillia's skins", "Star Guardian skins"
  boardType: string // champion | line | year | price | rarity
  who: string // account username, or "Guest"
  sTier: string[] // their S-tier skin names
  placed: number
  total: number
  at: string // ISO submission time
}
export interface TierFeedState {
  rows: TierFeedRow[]
  total: number // total community submissions (for the header / paging)
  offset: number
  pageSize: number
}

// Post-submit comparison: your placement vs the community's, per skin.
export interface TierResultRow {
  skinId: string
  name: string
  championName: string
  splashUrl: string
  yourTier: TierName
  communityTier: TierName // rating-quintile within this board (MVP)
  rating: number // updated community rating
  delta: number // this submission's rating move
  agreementPct: number | null // % who placed it in your tier (null until enough data)
  hotTake: boolean // your tier is ≥2 tiers off the community's
}

export interface TierListResult {
  rows: TierResultRow[] // your S→D order
  boardId: string // the board you just ranked (for the share link)
  nextBoard: TierBoard
  stats: TierListStats
  username: string | null // your account username, prefilled into the share card
  guestToken: string
}

export interface SharedRankingRow {
  skinId: string
  name: string
  championName: string
  splashUrl: string
  tier: TierName
}

// A pickable scope in "make your own", and the full catalog grouped by axis.
export interface TierScopeOption {
  boardId: string // e.g. 'champion:Lux', 'line:star-guardian', 'year:2021'
  label: string // human label ("Lux", "Star Guardian", "2021", "1350 RP")
  count: number // skins in the scope, before the served-board cap
}
export interface TierScopeCatalog {
  champions: TierScopeOption[]
  lines: TierScopeOption[]
  years: TierScopeOption[]
  prices: TierScopeOption[]
  rarities: TierScopeOption[]
}

// What a shared link (/battle/tier-drop?s=<id>) resolves to for the recipient.
export interface SharedTierListState {
  found: boolean // false = unknown/expired id (board is then a fresh fallback)
  shareId: string
  mode: 'reveal' | 'hide' | 'board'
  sharerName: string | null
  reveal: boolean // show the sharer's ranking immediately (reveal mode)
  board: TierBoard // the set the recipient (re)ranks
  ranking: SharedRankingRow[] | null // the sharer's tiers (reveal & hide); null for board
  stats: TierListStats
  guestToken: string
}

// ─── Price Point (internal id: price-check) ─────────────────────────────────

// An answered round. Facts only ship AFTER the guess - the unanswered
// round's price never reaches the client.
export interface PriceRoundResult {
  skinId: string
  name: string
  championName: string
  splashUrl: string
  guess: number
  actual: number
  correct: boolean
  oneOff: boolean // adjacent tier - the 🟨 in the share grid
  legacy: boolean // fun fact: vaulted, not even buyable anymore
  // How many players (incl. you) guessed this same tier for this skin today.
  guessedBy: number
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
  // True until the slice has real sample depth - rendered as the
  // "Early Rankings - still calibrating" banner (thin data is a call to
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
  slug: string // canonical - loaders redirect non-canonical spellings here
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
    calibrated: boolean // false = "Early ranking: needs more votes"
  } | null // null = never battled
  ratedTotal: number
  personal: {
    rating: number
    battles: number
    gap: number | null // vs community; null when the skin is unranked
  } | null
  guestToken: string
}

// ─── Home page ──────────────────────────────────────────────────────────────

// One hero slide: a catalog skin plus whatever live standing it has. The Elo
// rank is null until the skin has fought at least one battle.
export interface HomeSlide {
  skinId: string
  slug: string // stable URL: /skins/<slug>
  name: string
  championId: string
  championName: string
  splashUrl: string
  cost: number | null // RP price from the facts snapshot
  rank: number | null // Elo rank among rated skins
  battles: number
}

export interface HomeState {
  date: string // UTC day the slide set is seeded from
  slides: HomeSlide[]
  community: {
    battles: number // all battles ever fought, by everyone
    rated: number // skins with at least one battle
    catalog: number // playable skins in the catalog
  }
  drought: {
    top: DroughtRow[]
    stats: DroughtState['stats']
  } | null // null = no dated skins yet; the section hides itself
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
  // Champions with no dated skins (typically brand-new - the facts snapshot
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
// live in server/mirror.ts) - otherwise "contrarian" is just noise.
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
// line data is thin, a champion. Both can appear - entries are labeled.
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

// Live community totals for the public roadmap's milestone meters. The star
// and ban totals come from the Go API and are null when it is unreachable
// (the page renders without them rather than failing).
export interface RoadmapState {
  battles: number
  ratedSkins: number // skins with at least one battle
  totalSkins: number // full catalog size
  medianBattles: number // median battles among rated skins
}
