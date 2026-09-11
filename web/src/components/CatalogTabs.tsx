import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLayerGroup, faUsers } from '@fortawesome/free-solid-svg-icons'

// The catalog is ONE door with two lenses (ROUTES.md): every skin flat at
// /skins, the same catalog grouped by champion at /champions. This bar is what
// makes them read as one place rather than two pages that happen to share a
// subject - without it the two routes drift, which is exactly how /skins came
// to be missing while /champions carried the whole catalog alone.
const LENSES = [
  { to: '/skins', label: 'All Skins', icon: faLayerGroup },
  { to: '/champions', label: 'By Champion', icon: faUsers },
] as const

export default function CatalogTabs({
  current,
}: {
  current: '/skins' | '/champions'
}) {
  return (
    <nav
      aria-label="Catalog view"
      className="mb-6 flex flex-wrap items-center gap-2"
    >
      {LENSES.map((lens) => {
        const active = lens.to === current
        return (
          <Link
            key={lens.to}
            to={lens.to}
            aria-current={active ? 'page' : undefined}
            className={`flex h-10 items-center gap-2 px-3.5 text-sm font-bold outline -outline-offset-1 transition duration-150 ${
              active
                ? 'bg-gold5/40 text-gold1 outline-gold2'
                : 'bg-hextech-black/40 text-gold1 outline-icon/30 hover:bg-gold5/25 hover:outline-gold2/70'
            }`}
          >
            <FontAwesomeIcon icon={lens.icon} className="h-3.5 text-gold2" />
            {lens.label}
          </Link>
        )
      })}
    </nav>
  )
}
