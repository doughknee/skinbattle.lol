// Shared (client-safe) types for the games framework. Server-only logic
// lives under ./server — never import that from components.

export type GameId = 'splashdle'

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
