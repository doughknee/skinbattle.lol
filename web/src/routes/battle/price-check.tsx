import { createFileRoute, redirect } from '@tanstack/react-router'

// Price Check was renamed to Price Point and the URL moved to
// /battle/price-point. Kept as a redirect so old links and shared result
// URLs keep working. (The internal game id is still "price-check".)
export const Route = createFileRoute('/battle/price-check')({
  beforeLoad: () => {
    throw redirect({ to: '/battle/price-point' })
  },
})
