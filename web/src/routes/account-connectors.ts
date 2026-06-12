import { createFileRoute } from '@tanstack/react-router'

// Server-only route: GET /account-connectors lists the social connectors a
// signed-in user can link on the profile page. Logto publishes them at
// {endpoint}/api/.well-known/sign-in-exp, but that endpoint isn't CORS-open
// to our origin (only /my-account and /verifications are), so the SSR
// server fetches it and passes the relevant slice through.

interface SignInExp {
  socialConnectors?: {
    id: string
    target: string
    name?: Record<string, string> | string
    logo?: string
    logoDark?: string
  }[]
}

let cache: { at: number; body: unknown } | null = null
const CACHE_MS = 5 * 60 * 1000

export const Route = createFileRoute('/account-connectors')({
  server: {
    handlers: {
      GET: async () => {
        if (cache && Date.now() - cache.at < CACHE_MS) {
          return Response.json(cache.body)
        }
        const endpoint = process.env.LOGTO_ENDPOINT
        if (!endpoint) {
          return Response.json({ connectors: [] })
        }
        try {
          const res = await fetch(
            `${endpoint.replace(/\/$/, '')}/api/.well-known/sign-in-exp`,
            { signal: AbortSignal.timeout(5000) },
          )
          if (!res.ok) throw new Error(`sign-in-exp ${res.status}`)
          const exp = (await res.json()) as SignInExp
          const body = {
            connectors: (exp.socialConnectors ?? []).map((c) => ({
              id: c.id,
              target: c.target,
              // Logto i18n name object: prefer English, fall back to target.
              name:
                typeof c.name === 'string'
                  ? c.name
                  : (c.name?.en ?? c.target),
              logo: c.logo,
              logoDark: c.logoDark,
            })),
          }
          cache = { at: Date.now(), body }
          return Response.json(body)
        } catch (err) {
          console.warn('account-connectors:', (err as Error).message)
          return Response.json({ connectors: [] }, { status: 502 })
        }
      },
    },
  },
})
