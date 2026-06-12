import { createFileRoute } from '@tanstack/react-router'

// Server-only route: POST /games-attach binds the caller's Logto identity
// (proved by their API access token) to this device's games record —
// attachment, not migration (see lib/games/server/attach.ts). A rejected
// token writes nothing and returns 401.
export const Route = createFileRoute('/games-attach')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyLogtoToken, attachSub } = await import(
          '~/lib/games/server/attach'
        )
        let body: { accessToken?: string; restoreToken?: string | null }
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Malformed request.' }, { status: 400 })
        }
        if (!body.accessToken || typeof body.accessToken !== 'string') {
          return Response.json({ error: 'Missing access token.' }, { status: 400 })
        }
        const sub = await verifyLogtoToken(body.accessToken)
        if (!sub) {
          return Response.json({ error: 'Invalid token.' }, { status: 401 })
        }
        const result = attachSub(
          sub,
          typeof body.restoreToken === 'string' ? body.restoreToken : null,
        )
        return Response.json(result)
      },
    },
  },
})
