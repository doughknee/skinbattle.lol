// Invisible glue for design principle 9's second half: once a visitor is
// signed in, bind their Logto identity to this device's games record so
// guest progress (tier list, streaks, battle history) survives sign-up -
// and their votes count at member weight from the next refit.
//
// Mounted once in __root. Runs at most once per browser session per
// account (the sentinel stores the sub, so switching accounts re-runs it);
// the server side is idempotent anyway ('already' is a no-op).

import { useEffect, useRef } from 'react'
import { useAuth } from '~/lib/useAuth'
import { getLogtoClient } from '~/lib/logtoClient'
import {
  ATTACH_SESSION_KEY,
  guestRestoreToken,
  rememberGuestToken,
} from '~/lib/games/client'

export default function GuestAttachment() {
  const { isAuthenticated, getApiToken } = useAuth()
  const inFlight = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || inFlight.current) return
    inFlight.current = true
    void (async () => {
      try {
        const client = getLogtoClient()
        // The sub keys the once-per-session sentinel: if a different account
        // signed in mid-session (logout + login, or an expired session), the
        // stored sub won't match and we attach again. Falls back to a plain
        // marker if claims are unavailable - re-attaching is harmless.
        const sub = await client
          ?.getIdTokenClaims()
          .then((claims) => claims.sub)
          .catch(() => null)
        const marker = sub ?? '1'
        try {
          if (sessionStorage.getItem(ATTACH_SESSION_KEY) === marker) return
        } catch {
          /* storage disabled: attach every session - the server no-ops */
        }
        const accessToken = await getApiToken()
        if (!accessToken) return
        // The ID token carries the username claim for leaderboard display
        // names; optional - attachment works without it.
        const idToken = await client?.getIdToken().catch(() => null)
        const res = await fetch('/games-attach', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            accessToken,
            idToken: idToken ?? undefined,
            restoreToken: guestRestoreToken(),
          }),
        })
        if (!res.ok) return
        const result = (await res.json()) as {
          outcome: string
          guestToken: string
        }
        rememberGuestToken(result.guestToken)
        try {
          sessionStorage.setItem(ATTACH_SESSION_KEY, marker)
        } catch {
          /* fine */
        }
        if (result.outcome === 'merged' || result.outcome === 'switched') {
          // The device's games identity just changed - 'merged' folded guest
          // progress into the account, 'switched' pointed the device at a
          // different account's record. Loaders cached under the old
          // identity are stale either way; a soft reload re-reads.
          window.location.reload()
        }
      } catch {
        // Network blip - the next session retries.
      } finally {
        inFlight.current = false
      }
    })()
  }, [isAuthenticated, getApiToken])

  return null
}
