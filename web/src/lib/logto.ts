// Logto OIDC configuration, built from runtime public config.
import type { LogtoConfig } from '@logto/react'
import { UserScope } from '@logto/react'
import type { PublicConfig } from './config'
import { getPublicConfig } from './config'

export function makeLogtoConfig(c: PublicConfig): LogtoConfig {
  return {
    endpoint: c.logtoEndpoint,
    appId: c.logtoAppId,
    // Request the API resource so we can mint access tokens with the correct
    // audience for the Go API.
    resources: c.logtoResource ? [c.logtoResource] : [],
    // Identities unlocks the Account API's social-connector management
    // (lib/accountApi.ts). Scopes are baked into the grant at sign-in, so
    // sessions created before this scope was added must sign out and back
    // in before the security settings work.
    scopes: [UserScope.Email, UserScope.Profile, UserScope.Identities],
  }
}

// The API resource indicator, resolved at call time (browser runtime config).
export function getLogtoResource(): string {
  return getPublicConfig().logtoResource
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
