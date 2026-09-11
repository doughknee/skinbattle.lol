import { createFileRoute, redirect } from '@tanstack/react-router'

// The broad "best League of Legends skins" intent has ONE page: /rankings/all.
// This URL was published as the flagship slug by an earlier pass and then
// answered as a soft 404 (a 200 saying "No such slice"). A permanent redirect
// consolidates whatever it earned onto the page that actually holds the
// ranking, and seo.routes.test.ts pins both the status and the target.
export const Route = createFileRoute('/rankings/best-league-of-legends-skins')({
  beforeLoad: () => {
    throw redirect({ to: '/rankings/$slice', params: { slice: 'all' }, statusCode: 301 })
  },
})
