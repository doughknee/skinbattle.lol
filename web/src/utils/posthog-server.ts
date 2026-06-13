import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    // Runtime env first (prod containers), VITE_* fallback for local dev. Mirrors
    // readServerConfig() in ~/lib/config so client and server read the same keys.
    posthogClient = new PostHog(
      process.env.POSTHOG_PROJECT_TOKEN ||
        process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
        '',
      {
        host:
          process.env.POSTHOG_HOST ||
          process.env.VITE_PUBLIC_POSTHOG_HOST ||
          'https://us.i.posthog.com',
        flushAt: 1,
        flushInterval: 0,
      },
    )
  }
  return posthogClient
}
