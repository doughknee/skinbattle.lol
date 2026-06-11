import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

// Designed empty state for zero-data sections (no votes yet, etc.).
// `compact` is for per-section empties that repeat on one page; the default
// size is for a page's main attraction being empty.
export default function EmptyState({
  icon,
  title,
  message,
  cta,
  action,
  compact = false,
}: {
  icon: IconDefinition
  title: string
  message: string
  cta?: { to: string; label: string }
  action?: { label: string; onClick: () => void }
  compact?: boolean
}) {
  return (
    <div
      className={`animate-fade-in flex flex-col items-center bg-hextech-black/30 px-6 text-center outline outline-icon/20 -outline-offset-2 ${compact ? 'py-8' : 'py-14'}`}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2 ${compact ? 'mb-4 h-12 w-12' : 'mb-5 h-16 w-16'}`}
      >
        <FontAwesomeIcon
          icon={icon}
          className={`text-gold2 ${compact ? 'h-5' : 'h-6'}`}
        />
      </div>
      <h3
        className={`mb-2 font-serif font-bold text-gold1 ${compact ? 'text-lg' : 'text-2xl'}`}
      >
        {title}
      </h3>
      <p className={`max-w-md text-grey1 ${compact ? 'text-sm' : ''}`}>
        {message}
      </p>
      {(cta || action) && (
        <div
          className={`flex flex-wrap items-center justify-center gap-3 ${compact ? 'mt-5' : 'mt-8'}`}
        >
          {cta && (
            <Link to={cta.to} className={btnPrimarySm}>
              {cta.label}
            </Link>
          )}
          {action && (
            <button onClick={action.onClick} className={btnSecondarySm}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
