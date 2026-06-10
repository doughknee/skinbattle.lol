import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

// Designed empty state for zero-data sections (no votes yet, etc.).
export default function EmptyState({
  icon,
  title,
  message,
  cta,
}: {
  icon: IconDefinition
  title: string
  message: string
  cta?: { to: string; label: string }
}) {
  return (
    <div className="flex flex-col items-center bg-hextech-black/30 px-6 py-14 text-center outline outline-icon/20 -outline-offset-2">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
        <FontAwesomeIcon icon={icon} className="h-6 text-gold2" />
      </div>
      <h3 className="mb-2 font-serif text-2xl font-bold text-gold1">{title}</h3>
      <p className="mb-8 max-w-md text-grey1">{message}</p>
      {cta && (
        <Link
          to={cta.to}
          className="bg-gold5/20 px-6 py-3 font-serif font-bold text-gold1 outline outline-gold2/60 -outline-offset-2 hover:bg-gold5/40 hover:outline-gold2 transition duration-150"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
