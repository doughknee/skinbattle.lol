import { Link, useRouterState } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faHouse,
  faUsers,
  faCrown,
  faShirt,
  faDice,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import AccountButton from './AccountButton'
import QuotaChip from './QuotaChip'
import { CrownMark, Wordmark } from './Brand'
import { openCommandPalette } from './CommandPalette'

// Profile lives behind the account button in the right cluster.
const navLinks: { to: string; label: string; icon: IconDefinition }[] = [
  { to: '/', label: 'Home', icon: faHouse },
  { to: '/champions', label: 'Champions', icon: faUsers },
  { to: '/skins', label: 'Skins', icon: faShirt },
  { to: '/awards', label: 'Awards', icon: faCrown },
  { to: '/games', label: 'Games', icon: faDice },
]

export default function NavBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to)

  return (
    <nav className="fixed top-0 left-0 z-50 w-full border-b border-b-icon/30 border-t-2 border-t-gold5 bg-hextech-black/40 backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-2 px-3 md:h-[68px] md:px-6">
        {/* Crown + wordmark (crown alone on mobile) */}
        <Link
          to="/"
          aria-label="SkinBattle home"
          className="flex shrink-0 items-center gap-2 pr-2 md:pr-4"
        >
          <CrownMark className="h-8 w-8" />
          <Wordmark className="hidden text-lg md:inline" />
        </Link>

        {/* Primary nav */}
        <div className="flex h-full min-w-0 items-center">
          {navLinks.map(({ to, label, icon }) => {
            const active = isActive(to)
            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={`flex h-full items-center gap-2 px-2.5 transition duration-350 hover:bg-linear-to-b hover:from-40% hover:from-transparent hover:via-60% hover:via-gold2/10 hover:to-99% hover:to-gold2/40 md:px-3.5 ${
                  active
                    ? 'bg-linear-to-b from-40% from-transparent via-60% via-gold2/10 to-99% to-gold2/20'
                    : ''
                }`}
              >
                <FontAwesomeIcon
                  icon={icon}
                  className={`h-5 ${active ? 'text-gold1' : 'text-icon'}`}
                />
                <span
                  className={`hidden font-serif text-sm font-bold md:inline ${
                    active ? 'text-gold1' : 'text-grey1'
                  }`}
                >
                  {label}
                </span>
              </Link>
            )
          })}
        </div>

        {/* Right cluster: search, quota, account */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={openCommandPalette}
            type="button"
            aria-label="Search champions and skins (Ctrl+K)"
            title="Search (Ctrl+K)"
            className="flex h-10 cursor-pointer items-center gap-2 bg-hextech-black/40 px-3 text-sm font-bold text-grey1 outline outline-icon/30 -outline-offset-1 hover:text-gold1 hover:outline-icon transition duration-150"
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} className="h-4 text-gold2" />
            <span className="hidden lg:inline">Search</span>
            <kbd className="hidden px-1.5 py-0.5 text-[10px] text-grey1 outline outline-icon/30 lg:inline">
              Ctrl K
            </kbd>
          </button>
          <QuotaChip />
          <AccountButton />
        </div>
      </div>
    </nav>
  )
}
