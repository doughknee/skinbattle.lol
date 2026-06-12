import { createFileRoute, redirect } from '@tanstack/react-router'

// The votes page moved into the profile page - kept as a redirect so old
// bookmarks keep working.
export const Route = createFileRoute('/user/votes')({
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})
