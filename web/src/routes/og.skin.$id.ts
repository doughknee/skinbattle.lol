import { createFileRoute } from '@tanstack/react-router'

// Server-only route: /og/skin/<id> serves the per-skin OG share-card PNG
// (splash + rating ± confidence + rank + battles). Skin pages point their
// og:image here.
export const Route = createFileRoute('/og/skin/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { skinOgResponse } = await import('~/lib/games/server/og')
        return skinOgResponse(params.id)
      },
    },
  },
})
