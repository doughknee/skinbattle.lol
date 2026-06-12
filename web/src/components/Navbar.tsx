import { Fragment, useState, type MouseEvent } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faChevronDown,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons'
import AccountButton from './AccountButton'
import QuotaChip from './QuotaChip'
import { CrownMark, Wordmark } from './Brand'
import { openCommandPalette } from './CommandPalette'
import { SITE_SECTIONS, type SiteSection } from '~/lib/siteMap'

// Primary nav renders from the site-map registry (~/lib/siteMap). Sections
// with children get a hover/focus dropdown on desktop; on mobile the panel is
// hidden and tapping the section lands on its hub page, which lists the same
// children. Home lives on the logo; profile behind the account button. The
// `accent` section (Battle - the brand verb) renders highlighted.

const itemShade =
  'bg-linear-to-b from-40% from-transparent via-60% via-gold2/10 to-99% to-gold2/20'
const itemHover =
  'hover:bg-linear-to-b hover:from-40% hover:from-transparent hover:via-60% hover:via-gold2/10 hover:to-99% hover:to-gold2/40'
// Same gradient, but driven by the whole .group - the trigger stays lit while
// the pointer (or keyboard focus) is anywhere inside its dropdown.
const groupShade =
  'group-hover:bg-linear-to-b group-hover:from-40% group-hover:from-transparent group-hover:via-60% group-hover:via-gold2/10 group-hover:to-99% group-hover:to-gold2/40 group-focus-within:bg-linear-to-b group-focus-within:from-40% group-focus-within:from-transparent group-focus-within:via-60% group-focus-within:via-gold2/10 group-focus-within:to-99% group-focus-within:to-gold2/40'

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

  // Clicking any menu link dismisses the panel immediately. The blur matters:
  // a clicked link keeps focus, and group-focus-within would otherwise pin
  // the panel open after the pointer leaves. Mouse-leave re-arms the menu.
  const [menuDismissed, setMenuDismissed] = useState(false)
  const dismissMenu = (e: MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.blur()
    setMenuDismissed(true)
  }

  const trigger = (
    <Link
      to={section.to}
      aria-label={section.label}
      aria-current={active ? 'page' : undefined}
      title={section.label}
      onClick={hasMenu ? dismissMenu : undefined}
      className={`relative flex h-full items-center gap-2 overflow-hidden px-2.5 transition duration-350 md:px-3.5 ${
        hasMenu ? groupShade : itemHover
      } ${active ? itemShade : ''} ${
        // Battle's three states: idle = embers only (faint glow on hover),
        // active = the full ember bed + gold tint.
        section.accent ? (active ? 'bg-gold5/15 battle-accent' : 'battle-idle') : ''
      }`}
    >
      {section.accent && (
        <span className="battle-embers" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
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

  const hero = section.children!.find((c) => c.hero)
  const rest = section.children!.filter((c) => !c.hero)

  return (
    <div
      className="group relative h-full"
      onMouseLeave={() => setMenuDismissed(false)}
    >
      {trigger}
      {/* Desktop dropdown. opacity (not visibility) keeps the links tabbable,
          so keyboard focus reveals the panel via group-focus-within. After a
          click it hides outright until the pointer leaves and returns. */}
      <div
        className={`${
          menuDismissed ? 'hidden' : 'hidden md:block'
        } pointer-events-none absolute left-0 top-full w-[22rem] -translate-y-1 opacity-0 transition-all duration-150 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100`}
      >
        <div className="border-t-2 border-t-gold5 bg-hextech-black/95 pb-2 shadow-2xl outline outline-icon/30 -outline-offset-1 backdrop-blur-2xl">
          {/* The featured destination - the menu leads with what to do. */}
          {hero && (
            <Link
              to={hero.to}
              onClick={dismissMenu}
              className="group/hero flex items-center gap-3 border-b border-icon/20 bg-gold5/10 px-4 py-4 transition duration-150 hover:bg-gold5/20"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold2/60 -outline-offset-2">
                <FontAwesomeIcon icon={hero.icon} className="h-4.5 text-gold1" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-base font-bold text-gold1">
                  {hero.label}
                </span>
                <span className="block text-xs text-grey1">{hero.blurb}</span>
              </span>
              <FontAwesomeIcon
                icon={faArrowRight}
                className="h-3.5 shrink-0 text-gold2 transition duration-150 group-hover/hero:translate-x-0.5"
              />
            </Link>
          )}
          {rest.map((c, i) => (
            <Fragment key={c.to}>
              {c.group && c.group !== rest[i - 1]?.group && (
                <p className="px-4 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold2/70">
                  {c.group}
                </p>
              )}
              <Link
                to={c.to}
                onClick={dismissMenu}
                className="group/row flex items-center gap-3 px-4 py-2.5 transition duration-150 hover:bg-gold5/15"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/50 -outline-offset-2 transition duration-150 group-hover/row:outline-gold2/70">
                  <FontAwesomeIcon icon={c.icon} className="h-3.5 text-gold2" />
                </span>
                <span className="min-w-0">
                  <span className="block font-serif text-sm font-bold text-gold1">
                    {c.label}
                  </span>
                  <span className="block text-xs text-grey1">{c.blurb}</span>
                </span>
              </Link>
            </Fragment>
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

        {/* Primary nav - Home lives on the logo */}
        <div className="flex h-full min-w-0 items-center">
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
