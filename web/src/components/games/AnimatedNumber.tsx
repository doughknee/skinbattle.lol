import { useEffect, useState, type ComponentType } from 'react'

// Client-only Motion+ AnimateNumber.
//
// motion-plus is a CLIENT animation library; statically importing it pulls it
// into the SSR module graph, and (because the package currently resolves from
// the repo-root node_modules where it can't find `react`) that breaks the
// route's server render and drops it to client-only — which causes an empty
// first paint and a footer layout-shift. So we import it dynamically, on the
// client, after mount. SSR + the first client paint render the plain number;
// the odometer takes over once the chunk loads. If motion-plus is missing
// entirely, this simply stays on the plain number — no crash.

type NumberFormat = Intl.NumberFormatOptions

// Module-level cache so only the first instance pays the dynamic import.
let Loaded: ComponentType<{ format?: NumberFormat; children: number }> | null =
  null

function plain(value: number, format?: NumberFormat): string {
  if (format?.minimumIntegerDigits) {
    return String(Math.trunc(value)).padStart(format.minimumIntegerDigits, '0')
  }
  return value.toLocaleString('en-US', format)
}

export function AnimatedNumber({
  value,
  format,
}: {
  value: number
  format?: NumberFormat
}) {
  const [Comp, setComp] = useState(() => Loaded)
  useEffect(() => {
    if (Loaded) return
    let alive = true
    void import('motion-plus/react').then((m) => {
      Loaded = m.AnimateNumber as typeof Loaded
      if (alive) setComp(() => Loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!Comp) return <>{plain(value, format)}</>
  return <Comp format={format}>{value}</Comp>
}
