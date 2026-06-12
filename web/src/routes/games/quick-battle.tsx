import { createFileRoute, redirect } from '@tanstack/react-router'

// Quick Battle was promoted to the /battle door itself - kept as a redirect
// so old links keep working. Search params are forwarded because the manual
// rating-refit trigger (?refit=<secret>) may still be curled at the old URL.
export const Route = createFileRoute('/games/quick-battle')({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/battle', search: search as never })
  },
})
