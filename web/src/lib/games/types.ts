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
  guestToken: string
}
