import { createFileRoute, redirect } from '@tanstack/react-router'

// The Awards (star/ban superlatives) page was retired along with the star/ban
// voting system - head-to-head Elo is the sole ranking now. Kept as a redirect
// so old bookmarks and links land on the full ranking instead of a 404.
export const Route = createFileRoute('/rankings/awards')({
  beforeLoad: () => {
    throw redirect({ to: '/rankings/$slice', params: { slice: 'all' } })
  },
})
