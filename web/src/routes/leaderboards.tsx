import { createFileRoute, redirect } from '@tanstack/react-router'

// Leaderboards moved under /games (it's a games feature) — kept as a
// redirect so old bookmarks and shared links keep working.
export const Route = createFileRoute('/leaderboards')({
  beforeLoad: () => {
    throw redirect({ to: '/games/leaderboards' })
  },
})
