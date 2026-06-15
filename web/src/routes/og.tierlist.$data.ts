import { createFileRoute } from '@tanstack/react-router'

// Downloadable tier-list share image: /og/tierlist/<encoded-share-payload>.png
// The $data segment is the base64url share payload (see lib/games/share.ts).
export const Route = createFileRoute('/og/tierlist/$data')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tierShareImageResponse } = await import('~/lib/games/server/og')
        return tierShareImageResponse(params.data)
      },
    },
  },
})
