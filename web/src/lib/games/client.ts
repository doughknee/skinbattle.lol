// Client-side guest-token backup (design: cookie + localStorage backup).
// The cookie is httpOnly, so the server echoes the token in every game
// response; we mirror it here and send it back as `restoreToken` so progress
// survives a cleared cookie.

const KEY = 'sb:guest-token'

export function guestRestoreToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function rememberGuestToken(token: string): void {
  // Empty token = anonymous read (no user minted yet) — keep any existing
  // backup rather than clobbering it.
  if (!token) return
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // Private mode / storage disabled: the cookie alone still works.
  }
}
