import { createFileRoute, redirect } from '@tanstack/react-router'

// Account settings moved into the profile page — kept as a redirect so old
// bookmarks keep working.
export const Route = createFileRoute('/account')({
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})
