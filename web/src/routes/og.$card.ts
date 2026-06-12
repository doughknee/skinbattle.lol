import { createFileRoute } from '@tanstack/react-router'

// Server-only route: /og/<card> serves the 1200×630 OG share-card PNG for a
// games surface (see lib/games/server/og.ts). No component — scrapers and
// browsers GET it directly; pages point at it from their og:image meta.
export const Route = createFileRoute('/og/$card')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { ogCardResponse } = await import('~/lib/games/server/og')
        return ogCardResponse(params.card)
      },
    },
  },
})
