import { createFileRoute, redirect } from '@tanstack/react-router'

// Awards (the star/ban superlatives) was retired with the star/ban voting
// system - head-to-head Elo is the sole ranking now. Kept as a redirect so old
// bookmarks land on the full ranking instead of a 404.
export const Route = createFileRoute('/awards')({
  beforeLoad: () => {
    throw redirect({ to: '/rankings/$slice', params: { slice: 'all' } })
  },
})
