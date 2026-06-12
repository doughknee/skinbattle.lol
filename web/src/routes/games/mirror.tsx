import { createFileRoute, redirect } from '@tanstack/react-router'

// The Mirror moved under /battle (interim home — it becomes the profile's
// centerpiece in a later phase) — kept as a redirect so old links work.
export const Route = createFileRoute('/games/mirror')({
  beforeLoad: () => {
    throw redirect({ to: '/battle/mirror' })
  },
})
