import { createFileRoute, redirect } from '@tanstack/react-router'

// The Mirror became the profile's centerpiece (the profile IS the mirror) —
// kept as a redirect so old links keep working.
export const Route = createFileRoute('/battle/mirror')({
  beforeLoad: () => {
    throw redirect({ to: '/profile' })
  },
})
