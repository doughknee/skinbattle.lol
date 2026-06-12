import { createFileRoute } from '@tanstack/react-router'

// Server-only route: /og/rankings/<slice> serves the ranking-slice share
// card (slice title + top-3 podium over the #1 splash).
export const Route = createFileRoute('/og/rankings/$slice')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { rankingsOgResponse } = await import('~/lib/games/server/og')
        return rankingsOgResponse(params.slice)
      },
    },
  },
})
