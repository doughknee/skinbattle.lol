import { createFileRoute, redirect } from '@tanstack/react-router'

// The dailies moved under /battle - kept as a redirect so old links and
// share-text URLs keep working.
export const Route = createFileRoute('/games/splashdle')({
  beforeLoad: () => {
    throw redirect({ to: '/battle/splashdle' })
  },
})
