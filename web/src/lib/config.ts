// Public (non-secret) config the browser needs: Logto endpoint/app/resource and
// the API URL. In production these are injected at RUNTIME by the SSR server into
// `window.__APP_CONFIG__` (see routes/__root.tsx), so changing an env var +
// restarting the web container is enough - no rebuild. For local `vite dev` we
// fall back to build-time `VITE_*` vars.

export interface PublicConfig {
  logtoEndpoint: string
  logtoAppId: string
  logtoResource: string
  apiUrl: string
  // PostHog: project token is a PUBLIC client token (shipped to the browser).
  // Empty token disables analytics (see ClientProviders). posthogHost is only
  // the ui_host for toolbar deep-links; ingestion goes same-origin via /ingest.
  posthogToken: string
  posthogHost: string
}

declare global {
  interface Window {
    __APP_CONFIG__?: PublicConfig
  }
}

function viteFallback(): PublicConfig {
  return {
    logtoEndpoint: import.meta.env.VITE_LOGTO_ENDPOINT || '',
    logtoAppId: import.meta.env.VITE_LOGTO_APP_ID || '',
    logtoResource: import.meta.env.VITE_LOGTO_RESOURCE || '',
    apiUrl: import.meta.env.VITE_API_URL || '/api',
    posthogToken: import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN || '',
    posthogHost: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || '',
  }
}

// Read on the SERVER (SSR) from runtime env, falling back to build-time VITE_*.
export function readServerConfig(): PublicConfig {
  // The root loader calls this on client-side navigations too (e.g. a
  // same-route navigate), where server env doesn't exist. Reuse the
  // runtime-injected config - returning empty strings here would replace the
  // Logto client with one pointing at an empty endpoint, flipping the UI to
  // signed-out and breaking sign-in until a full reload.
  if (typeof window !== 'undefined' && window.__APP_CONFIG__) {
    return window.__APP_CONFIG__
  }
  const env = (typeof process !== 'undefined' && process.env) || ({} as Record<string, string | undefined>)
  const fb = viteFallback()
  return {
    logtoEndpoint: env.LOGTO_ENDPOINT || fb.logtoEndpoint,
    logtoAppId: env.LOGTO_APP_ID || fb.logtoAppId,
    logtoResource: env.LOGTO_RESOURCE || fb.logtoResource,
    apiUrl: env.PUBLIC_API_URL || fb.apiUrl,
    posthogToken: env.POSTHOG_PROJECT_TOKEN || fb.posthogToken,
    posthogHost: env.POSTHOG_HOST || fb.posthogHost,
  }
}

// Read on the BROWSER from the runtime-injected global, falling back to VITE_*.
export function getPublicConfig(): PublicConfig {
  if (typeof window !== 'undefined' && window.__APP_CONFIG__) {
    return window.__APP_CONFIG__
  }
  return viteFallback()
}
