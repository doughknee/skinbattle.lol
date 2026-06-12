import { createFileRoute, redirect } from '@tanstack/react-router'

// The Drought Index moved under /rankings (it's a ranking, not a game) —
// kept as a redirect so old bookmarks and shared links keep working.
export const Route = createFileRoute('/insights/drought')({
  beforeLoad: () => {
    throw redirect({ to: '/rankings/drought' })
  },
})
