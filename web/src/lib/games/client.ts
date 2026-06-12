// Client-side guest-token backup (design: cookie + localStorage backup).
// The cookie is httpOnly, so the server echoes the token in every game
// response; we mirror it here and send it back as `restoreToken` so progress
// survives a cleared cookie.

const KEY = 'sb:guest-token'

// Sentinel that GuestAttachment uses to run at most once per tab session
// per account (value = the Logto sub it last attached).
export const ATTACH_SESSION_KEY = 'sb:attached'

export function guestRestoreToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function rememberGuestToken(token: string): void {
  // Empty token = anonymous read (no user minted yet) - keep any existing
  // backup rather than clobbering it.
  if (!token) return
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // Private mode / storage disabled: the cookie alone still works.
  }
}

// Logout cleanup: drop every trace of this device's games identity - the
// localStorage backup, the attach sentinel, and (via the server, since it's
// httpOnly) the guest cookie. Without this, the next account to sign in on
// this browser would inherit this record. Best-effort on every step: the
// server also refuses cross-account attachment (attach.ts), so a failed
// fetch here degrades safely.
export async function clearGuestIdentity(): Promise<void> {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* storage disabled */
  }
  try {
    sessionStorage.removeItem(ATTACH_SESSION_KEY)
  } catch {
    /* storage disabled */
  }
  try {
    await fetch('/games-logout', { method: 'POST', credentials: 'include' })
  } catch {
    /* offline - the cookie outlives logout, but attach.ts won't rebind it */
  }
}
