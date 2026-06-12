import { createFileRoute, redirect } from '@tanstack/react-router'

// Awards moved under /rankings (it's a verdict surface) - kept as a redirect
// so old bookmarks keep working.
export const Route = createFileRoute('/awards')({
  beforeLoad: () => {
    throw redirect({ to: '/rankings/awards' })
  },
})
