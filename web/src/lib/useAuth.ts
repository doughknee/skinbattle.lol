// Thin wrapper around @logto/react's useLogto that centralizes the
// access-token-for-API-resource flow and the sign-in / sign-out redirects.
import { useCallback } from 'react'
import { useLogto } from '@logto/react'
import { getLogtoResource, redirectUri, postSignOutUri } from './logto'

export function useAuth() {
  const { isAuthenticated, isLoading, getAccessToken, signIn, signOut } =
    useLogto()

  // Returns a Logto access token scoped to the API resource, or null if the
  // user isn't signed in / the call fails.
  const getApiToken = useCallback(async (): Promise<string | null> => {
    if (!isAuthenticated) return null
    try {
      const token = await getAccessToken(getLogtoResource() || undefined)
      return token ?? null
    } catch {
      return null
    }
  }, [isAuthenticated, getAccessToken])

  const login = useCallback(() => {
    signIn(redirectUri())
  }, [signIn])

  const logout = useCallback(() => {
    signOut(postSignOutUri())
  }, [signOut])

  return { isAuthenticated, isLoading, getApiToken, login, logout }
}
