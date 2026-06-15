import { Link } from '@tanstack/react-router'

// Battle › [game]. Matches the Tier List page's breadcrumb so every game page
// reads the same.
export default function GameBreadcrumb({ label }: { label: string }) {
  return (
    <nav className="mb-5 flex items-center gap-2 text-xs font-semibold text-grey1">
      <Link to="/battle" className="transition-colors hover:text-gold1">
        Battle
      </Link>
      <span className="text-icon/40">/</span>
      <span className="text-gold2">{label}</span>
    </nav>
  )
}
