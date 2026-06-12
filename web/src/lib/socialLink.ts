// The social-link round trip crosses a full page navigation (provider OAuth
// redirect), so everything /social-callback needs to finish the job is
// stashed in sessionStorage before leaving: the Logto verification record,
// the CSRF state, the identity-proof record, and where to return.

const KEY = 'sb:social-link'

export interface SocialLinkStash {
  verificationRecordId: string
  state: string
  proofId: string
  redirectUri: string
  target: string
  name: string
}

export function saveSocialLinkStash(stash: SocialLinkStash): void {
  sessionStorage.setItem(KEY, JSON.stringify(stash))
}

export function loadSocialLinkStash(): SocialLinkStash | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SocialLinkStash
    return parsed && typeof parsed.verificationRecordId === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

export function clearSocialLinkStash(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* fine */
  }
}

export function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
