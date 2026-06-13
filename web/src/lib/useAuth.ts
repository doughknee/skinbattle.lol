// Auth wrapper around @logto/react that makes token failures recoverable.
//
// - getApiToken talks to the Logto client directly (the useLogto() proxy
//   swallows errors and returns undefined), so a dead session - expired or
//   revoked refresh token - can be told apart from a transient network blip.
// - A dead session clears the local tokens and flips the UI to signed-out,
//   instead of leaving a zombie "header says signed in but every call fails"
//   state that only a manual sign-out could escape.
// - withApiToken retries an API call once with a force-refreshed token when
//   the server rejects one the SDK still considered valid (clock skew,
//   revocation).
import { useCallback, useSyncExternalStore } from 'react'
import { LogtoClientError, LogtoError, useLogto } from '@logto/react'
import { usePostHog } from 'posthog-js/react'
import { getLogtoClient } from './logtoClient'
import { getLogtoResource, redirectUri, postSignOutUri } from './logto'
import { clearGuestIdentity } from './games/client'
import { toast } from '~/components/Toaster'
import type { ApiError } from './api'

// Flipped when a token refresh fails terminally. isAuthenticated from the
// SDK only checks that an ID token exists in storage, so without this flag
// the UI would keep claiming the user is signed in.
let sessionExpired = false
const listeners = new Set<() => void>()

export const sessionExpiredStore = {
  get: () => sessionExpired,
  set(value: boolean) {
    if (sessionExpired === value) return
    sessionExpired = value
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

// The refresh token is missing, expired, or revoked - only a fresh sign-in
// can recover. (The token endpoint reports this as an OIDC `invalid_grant`
// error, which the SDK wraps in LogtoError as an unexpected response shape.)
function isSessionDead(err: unknown): boolean {
  if (err instanceof LogtoClientError) return true
  if (err instanceof LogtoError) {
    const data = err.data as { error?: string } | undefined
    return data?.error === 'invalid_grant'
  }
  return false
}

export function useAuth() {
  const { isAuthenticated: sdkAuthenticated, isLoading } = useLogto()
  const posthog = usePostHog()
  const expired = useSyncExternalStore(
    sessionExpiredStore.subscribe,
    sessionExpiredStore.get,
    () => false,
  )
  const isAuthenticated = sdkAuthenticated && !expired

  // Returns a Logto access token scoped to the API resource, or null if the
  // user isn't signed in / the token can't be obtained right now.
  const getApiToken = useCallback(
    async (opts?: { forceRefresh?: boolean }): Promise<string | null> => {
      if (!isAuthenticated) return null
      const client = getLogtoClient()
      if (!client) return null
      const resource = getLogtoResource() || undefined
      try {
        if (opts?.forceRefresh) await client.clearAccessToken()
        return (await client.getAccessToken(resource)) ?? null
      } catch (err) {
        if (isSessionDead(err)) {
          try {
            await client.clearAllTokens()
          } catch {
            /* best effort */
          }
          sessionExpiredStore.set(true)
          return null
        }
        // Transient failure (network, 5xx): one retry, keep the session.
        try {
          return (await client.getAccessToken(resource)) ?? null
        } catch {
          return null
        }
      }
    },
    [isAuthenticated],
  )

  // Returns the OPAQUE access token (no resource) that Logto's Account API
  // requires - a resource-bound JWT is rejected there. Same dead-session
  // handling as getApiToken.
  const getAccountToken = useCallback(async (): Promise<string | null> => {
    if (!isAuthenticated) return null
    const client = getLogtoClient()
    if (!client) return null
    try {
      return (await client.getAccessToken()) ?? null
    } catch (err) {
      if (isSessionDead(err)) {
        try {
          await client.clearAllTokens()
        } catch {
          /* best effort */
        }
        sessionExpiredStore.set(true)
        return null
      }
      try {
        return (await client.getAccessToken()) ?? null
      } catch {
        return null
      }
    }
  }, [isAuthenticated])

  // Runs an authenticated API call. If the server rejects the token (401),
  // forces a refresh and retries once before giving up.
  const withApiToken = useCallback(
    async <T>(
      fn: (token: string) => Promise<T>,
      signInMessage = 'Please sign in to continue.',
    ): Promise<T> => {
      const token = await getApiToken()
      if (!token) throw new Error(signInMessage)
      try {
        return await fn(token)
      } catch (err) {
        if ((err as Partial<ApiError>).status === 401) {
          const fresh = await getApiToken({ forceRefresh: true })
          if (fresh) return await fn(fresh)
        }
        throw err
      }
    },
    [getApiToken],
  )

  // login/logout talk to the Logto client directly instead of useLogto()'s
  // wrapped signIn/signOut: the wrappers flip the SDK-wide isLoading flag
  // (and signIn never resets it, assuming the page is about to unload), which
  // blanks every page that gates rendering on isLoading until the redirect
  // lands - or forever, if it fails. The wrappers also swallow errors; here a
  // failed redirect keeps the page intact and tells the user.
  const login = useCallback(() => {
    sessionExpiredStore.set(false)
    const client = getLogtoClient()
    if (!client) return
    client.signIn(redirectUri()).catch((err) => {
      console.error('sign-in redirect failed:', err)
      toast("Couldn't reach the sign-in service. Please try again.", 'error')
    })
  }, [])

  const logout = useCallback(() => {
    sessionExpiredStore.set(false)
    const client = getLogtoClient()
    if (!client) return
    posthog.capture('user_signed_out')
    posthog.reset()
    // Drop the games guest identity BEFORE the sign-out redirect unloads the
    // page - otherwise the next account on this browser inherits this
    // device's games record (tier list, history, streaks).
    clearGuestIdentity()
      .then(() => client.signOut(postSignOutUri()))
      .catch((err) => {
        console.error('sign-out redirect failed:', err)
        toast("Couldn't reach the sign-out service. Please try again.", 'error')
      })
  }, [posthog])

  return {
    isAuthenticated,
    isLoading,
    getApiToken,
    getAccountToken,
    withApiToken,
    login,
    logout,
  }
}
