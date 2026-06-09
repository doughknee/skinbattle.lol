// Logto OIDC configuration, read from Vite env vars.
import type { LogtoConfig } from '@logto/react'
import { UserScope } from '@logto/react'

export const logtoResource: string = import.meta.env.VITE_LOGTO_RESOURCE || ''

export const logtoConfig: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT || '',
  appId: import.meta.env.VITE_LOGTO_APP_ID || '',
  // Request the API resource so we can mint access tokens with the correct
  // audience for the Go API.
  resources: logtoResource ? [logtoResource] : [],
  scopes: [UserScope.Email, UserScope.Profile],
}

// Where Logto redirects back to after sign-in / sign-out.
export function redirectUri(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/callback`
}

export function postSignOutUri(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}
