// Shared types mirroring CONTRACT.md

export interface Skin {
  id: string
  champion_id: string
  num: number
  name: string
  chromas: boolean
  splash_url: string
}

export interface Champion {
  id: string
  key: string
  title: string
  blurb: string
  lore: string
  skins: Skin[]
}

export interface Me {
  id: number
  email: string
  username: string
  avatar_champion_id: string | null
}

// PATCH /api/me - partial update. For avatarChampionId, '' clears the avatar
// while an absent field leaves it unchanged.
export interface UpdateMeRequest {
  username?: string
  avatarChampionId?: string
}
