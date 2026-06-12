import { createFileRoute, redirect } from '@tanstack/react-router'

// The games hub became /battle (Quick Battle plays at the door; the dailies
// live below it) - kept as a redirect so old links keep working.
export const Route = createFileRoute('/games/')({
  beforeLoad: () => {
    throw redirect({ to: '/battle' })
  },
})
