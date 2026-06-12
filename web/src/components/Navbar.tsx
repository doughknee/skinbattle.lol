import { Link, useRouterState } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import AccountButton from './AccountButton'
import QuotaChip from './QuotaChip'
import { CrownMark, Wordmark } from './Brand'
import { openCommandPalette } from './CommandPalette'
import { HOME, SITE_SECTIONS, type SiteSection } from '~/lib/siteMap'

// Primary nav renders from the site-map registry (~/lib/siteMap). Sections
// with children get a hover/focus dropdown on desktop; on mobile the panel is
// hidden and tapping the section lands on its hub page, which lists the same
// children. Profile lives behind the account button in the right cluster.

const itemShade =
  'bg-linear-to-b from-40% from-transparent via-60% via-gold2/10 to-99% to-gold2/20'
const itemHover =
  'hover:bg-linear-to-b hover:from-40% hover:from-transparent hover:via-60% hover:via-gold2/10 hover:to-99% hover:to-gold2/40'

function sectionIsActive(section: SiteSection, pathname: string): boolean {
  if (section.to === '/') return pathname === '/'
  const own = pathname.startsWith(section.to)
  const child = (section.children ?? []).some((c) => pathname.startsWith(c.to))
  return own || child
}

function NavItem({ section }: { section: SiteSection }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = sectionIsActive(section, pathname)
  const hasMenu = (section.children?.length ?? 0) > 0

  const trigger = (
    <Link
      to={section.to}
      aria-label={section.label}
      aria-current={active ? 'page' : undefined}
      title={section.label}
      className={`flex h-full items-center gap-2 px-2.5 transition duration-350 md:px-3.5 ${itemHover} ${
        active ? itemShade : ''
      }`}
    >
      <FontAwesomeIcon
        icon={section.icon}
        className={`h-5 ${active ? 'text-gold1' : 'text-icon'}`}
      />
      <span
        className={`hidden font-serif text-sm font-bold md:inline ${
          active ? 'text-gold1' : 'text-grey1'
        }`}
      >
        {section.label}
      </span>
      {hasMenu && (
        <FontAwesomeIcon
          icon={faChevronDown}
          className="hidden h-2.5 text-icon transition duration-200 group-hover:rotate-180 group-hover:text-gold2 md:inline"
        />
      )}
    </Link>
  )

  if (!hasMenu) return trigger

  return (
    <div className="group relative h-full">
      {trigger}
      {/* Desktop dropdown. opacity (not visibility) keeps the links tabbable,
          so keyboard focus reveals the panel via group-focus-within. */}
      <div className="pointer-events-none absolute left-0 top-full hidden w-80 -translate-y-1 opacity-0 transition-all duration-150 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 md:block">
        <div className="border-t-2 border-t-gold5 bg-hextech-black/95 shadow-2xl outline outline-icon/30 -outline-offset-1 backdrop-blur-2xl">
          {section.children!.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="flex items-start gap-3 px-4 py-3 transition duration-150 hover:bg-gold5/15"
            >
              <FontAwesomeIcon
                icon={c.icon}
                className="mt-1 h-4 w-4 shrink-0 text-gold2"
              />
              <span className="min-w-0">
                <span className="block font-serif text-sm font-bold text-gold1">
                  {c.label}
                </span>
                <span className="block text-xs text-grey1">{c.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function NavBar() {
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
          <NavItem section={HOME} />
          {SITE_SECTIONS.map((s) => (
            <NavItem key={s.to} section={s} />
          ))}
        </div>

        {/* Right cluster: search, quota, account */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={openCommandPalette}
            type="button"
            aria-label="Search pages, champions, and skins (Ctrl+K)"
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
