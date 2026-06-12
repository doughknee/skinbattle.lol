import { createFileRoute, redirect } from '@tanstack/react-router'

// Leaderboards live under /battle - direct redirect (no chains) so old
// bookmarks keep working.
export const Route = createFileRoute('/leaderboards')({
  beforeLoad: () => {
    throw redirect({ to: '/battle/leaderboards' })
  },
})
