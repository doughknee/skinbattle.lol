// Auth wrapper around @logto/react that makes token failures recoverable.
//
// - getApiToken talks to the Logto client directly (the useLogto() proxy
//   swallows errors and returns undefined), so a dead session — expired or
//   revoked refresh token — can be told apart from a transient network blip.
// - A dead session clears the local tokens and flips the UI to signed-out,
//   instead of leaving a zombie "header says signed in but every call fails"
//   state that only a manual sign-out could escape.
// - withApiToken retries an API call once with a force-refreshed token when
//   the server rejects one the SDK still considered valid (clock skew,
//   revocation).
import { useCallback, useSyncExternalStore } from 'react'
import { LogtoClientError, LogtoError, useLogto } from '@logto/react'
import { getLogtoClient } from './logtoClient'
import { getLogtoResource, redirectUri, postSignOutUri } from './logto'
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

// The refresh token is missing, expired, or revoked — only a fresh sign-in
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
  const { isAuthenticated: sdkAuthenticated, isLoading, signIn, signOut } =
    useLogto()
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

  const login = useCallback(() => {
    sessionExpiredStore.set(false)
    signIn(redirectUri())
  }, [signIn])

  const logout = useCallback(() => {
    sessionExpiredStore.set(false)
    signOut(postSignOutUri())
  }, [signOut])

  return { isAuthenticated, isLoading, getApiToken, withApiToken, login, logout }
}
