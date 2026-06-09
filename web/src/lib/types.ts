// Shared types mirroring CONTRACT.md

export interface Skin {
  id: string
  champion_id: string
  num: number
  name: string
  chromas: boolean
  splash_url: string
  total_votes: number
  total_stars: number
  total_x: number
  // present only when the request is authenticated:
  user_vote?: number // -1 | 0 | 1
  user_star?: boolean
  user_x?: boolean
}

export interface Champion {
  id: string
  key: string
  title: string
  blurb: string
  lore: string
  skins: Skin[]
}

export interface AwardsResponse {
  topStarred: Skin[]
  topXed: Skin[]
  allSkins: Skin[]
}

export interface VoteRequest {
  skinId: string
  vote: -1 | 0 | 1
  star: boolean
  x: boolean
}

export interface VoteTotals {
  total_votes: number
  total_stars: number
  total_x: number
}

export interface VoteResponse {
  message: string
  totals: VoteTotals
}

export interface UserStats {
  usedStars: number
  usedX: number
}

export interface UserVotesResponse {
  skins: Skin[]
}

export interface Me {
  id: number
  email: string
  username: string
}
