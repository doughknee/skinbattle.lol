// Skeleton loaders shown while route data is fetching, shaped like the real
// content so the page doesn't jump when it arrives.

import { useEffect, useState } from 'react'

// The shared pool of loading quips. Routes pass their own signature quip as
// the opener; if loading takes long enough, we cycle through these.
const QUIPS = [
  'Stealing baron...',
  'Checking the loot tab...',
  'Invading enemy jungle...',
  'One-shotting the ADC...',
  'Blaming the jungler...',
  'Warding the river bush...',
  'Pinging ??? at the support...',
  'Buying a control ward (for once)...',
  'Flashing into the wall...',
  'Waiting for the cannon wave...',
  'Contesting scuttle crab...',
  'Banning Yuumi...',
  'Recalling for boots...',
  'Hovering your one-trick...',
  'Typing "gg go next"...',
  'Dodging skillshots...',
]

// Hextech-gold loading ring.
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-gold5/50 border-t-gold2 ${className}`}
    />
  )
}

// Spinner + quip line. Starts on the route's own quip, then cycles through
// the shared pool with a quick cross-fade while loading drags on.
export function LoadingQuip({ quip }: { quip: string }) {
  const [text, setText] = useState(quip)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    // Start the rotation at a random spot so repeat visits feel fresh.
    let i = Math.floor(Math.random() * QUIPS.length)
    let swap: ReturnType<typeof setTimeout>
    const interval = setInterval(() => {
      setFading(true)
      swap = setTimeout(() => {
        i = (i + 1) % QUIPS.length
        setText((prev) => {
          const next = QUIPS[i]
          return next === prev ? QUIPS[(i + 1) % QUIPS.length] : next
        })
        setFading(false)
      }, 200)
    }, 2400)
    return () => {
      clearInterval(interval)
      clearTimeout(swap)
    }
  }, [])

  return (
    <div role="status" className="flex items-center gap-3">
      <Spinner />
      <p
        className={`font-serif text-lg italic text-gold2 transition-opacity duration-200 ${fading ? 'opacity-0' : 'opacity-100'}`}
      >
        {text}
      </p>
    </div>
  )
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-12 max-w-3xl">
      <div className="skeleton mb-4 h-12 w-72" />
      <div className="skeleton h-5 w-96 max-w-full" />
    </div>
  )
}

export function SkinCardSkeleton() {
  return (
    <div className="bg-hextech-black/30 outline outline-icon/20 -outline-offset-1">
      <div className="skeleton aspect-video w-full" />
      <div className="space-y-2 p-3">
        <div className="skeleton mx-auto h-5 w-2/3" />
        <div className="skeleton h-10 w-full" />
      </div>
    </div>
  )
}

export function SkinGridSkeleton({
  count = 8,
  className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4',
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={`stagger ${className}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkinCardSkeleton key={i} />
      ))}
    </div>
  )
}

// Tier List pending state: header + five tier rows, sized like the real board
// so the footer doesn't ride up and shift when the content streams in.
export function TierListSkeleton() {
  return (
    <div className="animate-fade-in container mx-auto max-w-4xl px-4 pt-28 pb-16 md:px-6">
      <div className="mb-8">
        <LoadingQuip quip="Shuffling the tiers..." />
      </div>
      <div className="mb-6 space-y-3">
        <div className="skeleton h-10 w-72 max-w-full" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-stretch gap-2">
            <div className="skeleton h-[5.5rem] w-12 shrink-0 md:h-24" />
            <div className="skeleton h-[5.5rem] flex-1 md:h-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChampionGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div
      className="stagger grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="skeleton aspect-video w-full outline outline-icon/20 -outline-offset-1"
        />
      ))}
    </div>
  )
}

// Full route pending state: page-shaped skeleton with the loading quip and a
// spinner up top.
export function RouteSkeleton({
  quip,
  variant = 'skins',
}: {
  quip: string
  variant?: 'skins' | 'champions'
}) {
  return (
    <div className="animate-fade-in container mx-auto px-6 pt-28 pb-12">
      <div className="mb-8">
        <LoadingQuip quip={quip} />
      </div>
      <PageHeaderSkeleton />
      {variant === 'champions' ? (
        <ChampionGridSkeleton />
      ) : (
        <SkinGridSkeleton />
      )}
    </div>
  )
}

// Champion detail pending state: hero-shaped slab, then a skin grid.
export function ChampionDetailSkeleton({ quip }: { quip: string }) {
  return (
    <div className="animate-fade-in container mx-auto px-6 pt-28 pb-12">
      <div className="mb-8">
        <LoadingQuip quip={quip} />
      </div>
      <div className="mb-12 space-y-4">
        <div className="skeleton h-[42vh] w-full" />
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-5 w-96 max-w-full" />
      </div>
      <SkinGridSkeleton
        count={6}
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10"
      />
    </div>
  )
}

// Account tab pending state: settings-card-shaped slab.
export function AccountTabSkeleton() {
  return (
    <div
      className="animate-fade-in w-full max-w-md bg-hextech-black/30 p-8 outline outline-icon/20 -outline-offset-2"
      aria-hidden
    >
      <div className="mb-5 space-y-2">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-6 w-40" />
      </div>
      <div className="mb-8 space-y-2">
        <div className="skeleton h-3 w-12" />
        <div className="skeleton h-6 w-56" />
      </div>
      <div className="skeleton h-12 w-32" />
    </div>
  )
}

// Home pending state: hero-shaped skeleton so the landing page doesn't flash
// empty space during navigation.
export function HomeSkeleton() {
  return (
    <div className="animate-fade-in container mx-auto px-6 pt-32 pb-12">
      <div className="mb-10">
        <LoadingQuip quip="Loading the Rift..." />
      </div>
      <div className="max-w-2xl space-y-6">
        <div className="skeleton h-4 w-56" />
        <div className="skeleton h-16 w-full" />
        <div className="skeleton h-6 w-3/4" />
        <div className="flex gap-4 pt-4">
          <div className="skeleton h-14 w-44" />
          <div className="skeleton h-14 w-44" />
        </div>
      </div>
      <div className="mt-20">
        <SkinGridSkeleton
          count={4}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        />
      </div>
    </div>
  )
}
