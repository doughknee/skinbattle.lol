import { createFileRoute } from '@tanstack/react-router'

// Server-only route: POST /games-logout drops the httpOnly guest cookie so
// the next visitor on this browser - a fresh guest or a different account -
// doesn't inherit this device's games record (the cross-account leak fixed
// alongside lib/games/server/attach.ts). The record itself is untouched;
// signing back in re-attaches by logto_sub.
export const Route = createFileRoute('/games-logout')({
  server: {
    handlers: {
      POST: async () => {
        const { clearGuestCookie } = await import('~/lib/games/server/guests')
        clearGuestCookie()
        return Response.json({ ok: true })
      },
    },
  },
})
