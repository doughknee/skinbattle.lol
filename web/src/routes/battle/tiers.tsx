import { createFileRoute, redirect } from '@tanstack/react-router'

// /battle/tiers was renamed to /battle/tier-drop (to match the game name "Tier
// Drop"). Kept as a redirect so old links and shared ?s= result cards keep
// resolving — mirrors the price-check → price-point rename. Search is forwarded
// so share links (?s=) and picked-board links (?set=) survive the hop.
export const Route = createFileRoute('/battle/tiers')({
  validateSearch: (s: Record<string, unknown>): { s?: string; set?: string } => ({
    ...(typeof s.s === 'string' ? { s: s.s } : {}),
    ...(typeof s.set === 'string' ? { set: s.set } : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/battle/tier-drop', search })
  },
})
