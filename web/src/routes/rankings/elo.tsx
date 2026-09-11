import { createFileRoute, redirect } from '@tanstack/react-router'

// The rating explainer moved to /methodology, which is the same page grown up:
// it carries all of this content plus the data provenance and the confidence
// thresholds. Two URLs explaining one rating system is exactly the
// duplicate-content split DONI-83 spent its budget removing, so this is a
// permanent move, not a second door.
export const Route = createFileRoute('/rankings/elo')({
  beforeLoad: () => {
    throw redirect({ to: '/methodology', statusCode: 301 })
  },
})
