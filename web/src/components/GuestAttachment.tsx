// Invisible glue for design principle 9's second half: once a visitor is
// signed in, bind their Logto identity to this device's games record so
// guest progress (tier list, streaks, battle history) survives sign-up -
// and their votes count at member weight from the next refit.
//
// Mounted once in __root. Runs at most once per browser session per
// sign-in; the server side is idempotent anyway ('already' is a no-op).

import { useEffect, useRef } from 'react'
import { useAuth } from '~/lib/useAuth'
import { getLogtoClient } from '~/lib/logtoClient'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'

const SESSION_KEY = 'sb:attached'

export default function GuestAttachment() {
  const { isAuthenticated, getApiToken } = useAuth()
  const inFlight = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || inFlight.current) return
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return
    } catch {
      /* storage disabled: attach every session - the server no-ops */
    }
    inFlight.current = true
    void (async () => {
      try {
        const accessToken = await getApiToken()
        if (!accessToken) return
        // The ID token carries the username claim for leaderboard display
        // names; optional - attachment works without it.
        const idToken = await getLogtoClient()
          ?.getIdToken()
          .catch(() => null)
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
          sessionStorage.setItem(SESSION_KEY, '1')
        } catch {
          /* fine */
        }
        if (result.outcome === 'merged') {
          // Their device progress just joined the account - loaders cached
          // under the old guest are stale now; a soft reload re-reads as
          // the merged account.
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
