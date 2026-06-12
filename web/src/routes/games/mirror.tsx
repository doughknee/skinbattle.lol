import { createFileRoute, redirect } from '@tanstack/react-router'

// The Mirror became the profile's centerpiece - direct redirect (no chains)
// so old links keep working.
export const Route = createFileRoute('/games/mirror')({
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})
