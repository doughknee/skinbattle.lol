import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faShirt, faUsers } from '@fortawesome/free-solid-svg-icons'

// The catalog is one door with two lenses: every skin, or grouped by
// champion. Both routes render this switcher so moving between them feels
// like flipping a tab, not changing sections.

const tab = (active: boolean) =>
  `flex h-11 items-center gap-2.5 px-5 font-serif font-bold transition duration-150 outline -outline-offset-2 ${
    active
      ? 'bg-gold5/25 text-gold1 outline-gold2/60'
      : 'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
  }`

export default function CatalogTabs({
  active,
}: {
  active: 'skins' | 'champions'
}) {
  return (
    <div
      role="group"
      aria-label="Catalog view"
      className="mb-8 flex flex-wrap items-center gap-2"
    >
      <Link
        to="/skins"
        aria-current={active === 'skins' ? 'page' : undefined}
        className={tab(active === 'skins')}
      >
        <FontAwesomeIcon icon={faShirt} className="h-4" />
        All Skins
      </Link>
      <Link
        to="/champions"
        aria-current={active === 'champions' ? 'page' : undefined}
        className={tab(active === 'champions')}
      >
        <FontAwesomeIcon icon={faUsers} className="h-4" />
        By Champion
      </Link>
    </div>
  )
}
