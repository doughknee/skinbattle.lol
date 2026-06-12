import { createFileRoute, redirect } from '@tanstack/react-router'

// Leaderboards moved under /battle - kept as a redirect so old links keep
// working.
export const Route = createFileRoute('/games/leaderboards')({
  beforeLoad: () => {
    throw redirect({ to: '/battle/leaderboards' })
  },
})
