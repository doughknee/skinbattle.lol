import { createFileRoute, redirect } from '@tanstack/react-router'

// Quick Battle was promoted to the /battle door itself — kept as a redirect
// so old links keep working.
export const Route = createFileRoute('/games/quick-battle')({
  beforeLoad: () => {
    throw redirect({ to: '/battle' })
  },
})
