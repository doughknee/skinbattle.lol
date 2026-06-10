// Skeleton loaders shown while route data is fetching, shaped like the real
// content so the page doesn't jump when it arrives.

export function PageHeaderSkeleton() {
  return (
    <div className="mb-12 max-w-3xl">
      <div className="mb-4 h-12 w-72 animate-pulse bg-grey3/70" />
      <div className="h-5 w-96 max-w-full animate-pulse bg-grey3/50" />
    </div>
  )
}

export function SkinCardSkeleton() {
  return (
    <div className="bg-hextech-black/30 outline outline-icon/20 -outline-offset-2">
      <div className="aspect-video w-full animate-pulse bg-grey3/70" />
      <div className="space-y-2 p-3">
        <div className="mx-auto h-5 w-2/3 animate-pulse bg-grey3/70" />
        <div className="h-10 w-full animate-pulse bg-grey3/40" />
      </div>
    </div>
  )
}

export function SkinGridSkeleton({
  count = 8,
  className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4',
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkinCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function ChampionGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="aspect-video w-full animate-pulse bg-grey3/70 outline outline-icon/20 -outline-offset-2"
        />
      ))}
    </div>
  )
}

// Full route pending state: page-shaped skeleton with the loading quip kept
// as a small caption.
export function RouteSkeleton({
  quip,
  variant = 'skins',
}: {
  quip: string
  variant?: 'skins' | 'champions'
}) {
  return (
    <div className="container mx-auto p-4 pt-28">
      <p className="mb-8 font-serif text-lg italic text-gold2" role="status">
        {quip}
      </p>
      <PageHeaderSkeleton />
      {variant === 'champions' ? (
        <ChampionGridSkeleton />
      ) : (
        <SkinGridSkeleton />
      )}
    </div>
  )
}
