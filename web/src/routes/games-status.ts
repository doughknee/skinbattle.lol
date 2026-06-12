import { createFileRoute } from '@tanstack/react-router'

// Server-only route: /games-status is the freshness JSON an external uptime
// monitor watches (200 healthy / 503 stale). See lib/games/server/status.ts.
export const Route = createFileRoute('/games-status')({
  server: {
    handlers: {
      GET: async () => {
        const { gamesStatusResponse } = await import('~/lib/games/server/status')
        return gamesStatusResponse()
      },
    },
  },
})
