import { useEffect, useState } from 'react'
import { LogtoProvider } from '@logto/react'
import { PostHogProvider, usePostHog } from 'posthog-js/react'
import type { ReactNode } from 'react'
import type { PublicConfig } from '~/lib/config'
import { makeLogtoConfig } from '~/lib/logto'
import { CrossTabLogtoClient } from '~/lib/logtoClient'
import { useAuth } from '~/lib/useAuth'

export default function ClientProviders({
  children,
  config,
}: {
  children: ReactNode
  config: PublicConfig
}) {
  // Build the Logto config exactly once: LogtoProvider memoizes its client on
  // the config OBJECT, so a fresh object on any re-render (root loader
  // re-runs on navigation) would construct a brand-new Logto client mid-flight
  // and drop the existing auth state.
  const [logtoConfig] = useState(() => makeLogtoConfig(config))
  const app = (
    <LogtoProvider config={logtoConfig} LogtoClientClass={CrossTabLogtoClient}>
      <PostHogIdentitySync />
      {children}
    </LogtoProvider>
  )
  // No token (e.g. local dev without the key, or a preview env) → skip PostHog
  // entirely rather than initializing the client with an empty key.
  if (!config.posthogToken) return app
  return (
    <PostHogProvider
      apiKey={config.posthogToken}
      options={{
        // Same-origin ingestion: proxied to PostHog in dev (vite.config.ts) and
        // in prod (server.mjs), so ad-blockers can't drop the /ingest path.
        api_host: '/ingest',
        ui_host: config.posthogHost || undefined,
        defaults: '2025-05-24',
        capture_exceptions: true,
        debug: import.meta.env.DEV,
      }}
    >
      {app}
    </PostHogProvider>
  )
}

// Keep guest-vs-member context on EVERY event. register() persists the
// property and stamps it onto every subsequent capture, so funnels, retention,
// and replays can all be split by player_tier without each call site
// re-specifying it. Mounted inside both providers so it can read auth state
// (useAuth) and the client (usePostHog); a no-op when PostHog is disabled.
function PostHogIdentitySync() {
  const posthog = usePostHog()
  const { isAuthenticated, isLoading } = useAuth()
  useEffect(() => {
    // Wait for the SDK to resolve real auth state before tagging, so a
    // returning member isn't briefly mislabeled 'guest' on first paint.
    if (isLoading) return
    posthog?.register({
      is_authenticated: isAuthenticated,
      player_tier: isAuthenticated ? 'member' : 'guest',
    })
  }, [posthog, isAuthenticated, isLoading])
  return null
}
