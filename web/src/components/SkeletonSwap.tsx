import { useEffect, useState, type ReactNode } from 'react'

// Skeleton → content handoff: both layers share one grid cell, so the
// skeleton fades in over the (still-empty) content slot, shimmers while
// loading, then dissolves to reveal the real thing in place. Because the
// layers are stacked, there is no frame where the slot is empty and no
// reflow when content arrives — the skeleton literally becomes the thing
// it promised.
//
// `ready` should mean "visually ready", not "data arrived" — e.g. for an
// image region, flip it when the image has decoded, or the skeleton would
// dissolve over a dark box.
export default function SkeletonSwap({
  ready,
  skeleton,
  children,
  className = '',
}: {
  ready: boolean
  skeleton: ReactNode
  children: ReactNode
  className?: string
}) {
  // Unmount the skeleton layer on a timer after `ready`, not on
  // animationend — animations never finish in a backgrounded tab.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!ready) return
    const t = window.setTimeout(() => setGone(true), 320)
    return () => window.clearTimeout(t)
  }, [ready])

  return (
    <div className={`grid ${className}`}>
      <div className="col-start-1 row-start-1 min-w-0">{children}</div>
      {!gone && (
        <div
          aria-hidden
          className={`col-start-1 row-start-1 min-w-0 ${
            ready ? 'animate-fade-out' : 'animate-fade-in-fast'
          }`}
        >
          {skeleton}
        </div>
      )}
    </div>
  )
}
