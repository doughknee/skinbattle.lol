import { createFileRoute, redirect } from '@tanstack/react-router'

// The broad "best League of Legends skins" intent has ONE page: /rankings/all.
// This URL was published as the flagship slug by an earlier pass and then
// answered as a soft 404 (a 200 saying "No such slice"). A permanent redirect
// consolidates whatever it earned onto the page that actually holds the
// ranking. `search: true` carries the request's own query string across the
// hop: a ?utm_source=chatgpt.com that landed here used to arrive at
// /rankings/all bare, so the referral never reached PostHog.
// seo.routes.test.ts exercises the redirect and pins status, target and query.
export const Route = createFileRoute('/rankings/best-league-of-legends-skins')({
  beforeLoad: () => {
    throw redirect({
      to: '/rankings/$slice',
      params: { slice: 'all' },
      search: true,
      statusCode: 301,
    })
  },
})
