import type { ReactNode } from 'react'

// Standard page header: uppercase kicker, big serif title, subtitle.
// Keeps every listing page's opening block identical in scale and rhythm.
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  className = 'mb-14',
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  className?: string
}) {
  return (
    <header className={`max-w-3xl ${className}`}>
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          {eyebrow}
        </p>
      )}
      <h1 className="font-serif text-5xl md:text-6xl font-bold text-gold2">
        {title}
      </h1>
      {subtitle && <p className="mt-3 text-xl text-grey1">{subtitle}</p>}
    </header>
  )
}
