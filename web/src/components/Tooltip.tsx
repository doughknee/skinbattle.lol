import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

// The site's tooltip — a themed replacement for native `title=` bubbles. Built
// on Radix so it's keyboard/focus/ARIA-correct and portals over fixed overlays
// (the battle theater, milestone wash) without z-index fights. The shared
// delay/skip behavior is set once by the provider in ClientProviders; pass a
// `side` to steer placement (it still flips on collision).
export function Tooltip({
  label,
  children,
  side = 'top',
  sideOffset = 6,
}: {
  label: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}) {
  // No copy → render the trigger bare, so a dynamic empty label is a clean no-op.
  if (!label) return <>{children}</>
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={sideOffset}
          collisionPadding={10}
          // Crisp and in-theme: solid hextech panel, a thin gold hairline, and a
          // clean dark drop shadow for lift — matching the site's dropdown /
          // command-palette chrome. No gold glow (it muddied the edge).
          className="animate-tooltip-in z-[120] max-w-[16rem] text-balance select-none bg-hextech-black/95 px-2.5 py-1.5 text-xs leading-snug text-gold1 shadow-2xl outline outline-gold2/40 -outline-offset-1"
        >
          {label}
          <RadixTooltip.Arrow
            className="fill-hextech-black"
            width={11}
            height={5}
          />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

export default Tooltip
