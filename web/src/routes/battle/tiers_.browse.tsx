import { createFileRoute, redirect } from '@tanstack/react-router'

// /battle/tiers/browse was renamed to /battle/tier-drop/browse (Tier Drop
// rename). Kept as a redirect so old links keep resolving.
export const Route = createFileRoute('/battle/tiers_/browse')({
  beforeLoad: () => {
    throw redirect({ to: '/battle/tier-drop/browse' })
  },
})
