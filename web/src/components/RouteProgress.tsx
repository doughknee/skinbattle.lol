import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

// Thin indeterminate progress bar pinned to the top of the viewport while a
// route transition is pending. Complements the per-route skeletons: this is
// the instant "something is happening" signal, the skeleton is the shape.
export default function RouteProgress() {
  const isPending = useRouterState({ select: (s) => s.status === 'pending' })
  const [visible, setVisible] = useState(false)

  // Linger briefly after the transition resolves so the bar fades out
  // instead of vanishing mid-sweep.
  useEffect(() => {
    if (isPending) {
      setVisible(true)
      return
    }
    const timer = setTimeout(() => setVisible(false), 250)
    return () => clearTimeout(timer)
  }, [isPending])

  if (!visible) return null

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed left-0 top-0 z-[110] h-0.5 w-full overflow-hidden transition-opacity duration-250 ${isPending ? 'opacity-100' : 'opacity-0'}`}
    >
      <div
        className="h-full w-1/3 bg-gradient-to-r from-transparent via-gold2 to-transparent"
        style={{ animation: 'route-progress 1s ease-in-out infinite' }}
      />
    </div>
  )
}
