// Header-profile cache: AccountButton shows the cached name/avatar instantly
// on load instead of waiting on /me, and updates live (via the event) when
// the Account tab saves a change in the same session.

export interface CachedProfile {
  username: string | null
  avatarChampionId: string | null
}

const USERNAME_KEY = 'sb:username'
const AVATAR_KEY = 'sb:avatar'

export const PROFILE_UPDATED_EVENT = 'sb:profile-updated'

export function readCachedProfile(): CachedProfile {
  if (typeof window === 'undefined')
    return { username: null, avatarChampionId: null }
  try {
    return {
      username: localStorage.getItem(USERNAME_KEY),
      avatarChampionId: localStorage.getItem(AVATAR_KEY),
    }
  } catch {
    return { username: null, avatarChampionId: null }
  }
}

export function writeCachedProfile(profile: CachedProfile) {
  if (typeof window === 'undefined') return
  try {
    if (profile.username === null) localStorage.removeItem(USERNAME_KEY)
    else localStorage.setItem(USERNAME_KEY, profile.username)
    if (profile.avatarChampionId === null) localStorage.removeItem(AVATAR_KEY)
    else localStorage.setItem(AVATAR_KEY, profile.avatarChampionId)
  } catch {
    /* storage unavailable — the header falls back to /me */
  }
}

export function clearCachedProfile() {
  writeCachedProfile({ username: null, avatarChampionId: null })
}

// Persist the new profile and notify live listeners (the header button).
export function announceProfileUpdate(profile: CachedProfile) {
  writeCachedProfile(profile)
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(PROFILE_UPDATED_EVENT, { detail: profile }),
  )
}
