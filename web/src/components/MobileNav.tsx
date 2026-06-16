import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useRouterState } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { CrownMark, Wordmark } from './Brand'
import {
  CHAMPIONS,
  HOME,
  SECONDARY_PAGES,
  SITE_SECTIONS,
  type SiteSection,
} from '~/lib/siteMap'

// The mobile nav. The desktop navbar leans on hover dropdowns that a tap can't
// open, so phones get a dedicated full-screen takeover instead: the three doors
// as big tiles (Battle keeps its ember bed), each fanning out its children as
// chips. Gamified and thumb-friendly - the whole panel is one reachable column.

function isActive(to: string, match: string | undefined, pathname: string) {
  if (to === '/') return pathname === '/'
  return pathname.startsWith(match ?? to)
}

function DoorTile({
  section,
  pathname,
}: {
  section: SiteSection
  pathname: string
}) {
  const active = isActive(section.to, section.match, pathname)
  // Drop the child that just repeats the landing page (a dropdown's hero), but
  // keep tab-links that share the path yet target a distinct view (?tab=...).
  const children = (section.children ?? []).filter(
    (c) => c.to !== section.to || c.linkSearch,
  )

  return (
    <li className="flex flex-col gap-2">
      <Link
        to={section.to}
        className={`relative flex items-center gap-4 overflow-hidden p-4 outline -outline-offset-1 transition duration-150 ${
          section.accent
            ? active
              ? 'bg-gold5/20 battle-accent outline-gold2'
              : 'bg-hextech-black/50 battle-idle outline-gold5/60'
            : active
              ? 'bg-gold5/20 outline-gold2'
              : 'bg-hextech-black/40 outline-icon/25 hover:outline-gold2/70'
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
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold2/50 -outline-offset-2">
          <FontAwesomeIcon icon={section.icon} className="h-5 text-gold1" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-xl font-bold text-gold1">
            {section.label}
          </span>
          <span className="block text-sm text-grey1">{section.blurb}</span>
        </span>
        <FontAwesomeIcon
          icon={faChevronRight}
          className="h-4 shrink-0 text-gold2"
        />
      </Link>

      {children.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-2">
          {children.map((c) => (
            <Link
              key={`${c.to}-${c.label}`}
              to={c.to}
              search={c.linkSearch}
              className="flex h-9 items-center gap-2 bg-hextech-black/40 px-3 text-sm font-bold text-gold1 outline outline-icon/25 -outline-offset-1 transition duration-150 hover:bg-gold5/25 hover:outline-gold2/70"
            >
              <FontAwesomeIcon icon={c.icon} className="h-3.5 text-gold2" />
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </li>
  )
}

export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Any navigation (tapping a link) closes the panel.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.style.overflow = prevOverflow
    }
  }, [open])

  const footerLinks = [HOME, CHAMPIONS, ...SECONDARY_PAGES]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex h-10 w-10 cursor-pointer items-center justify-center bg-hextech-black/40 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-icon md:hidden"
      >
        <FontAwesomeIcon icon={faBars} className="h-5 text-gold2" />
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-0 z-[90] flex flex-col border-t-2 border-t-gold5 bg-hextech-black/95 backdrop-blur-xl md:hidden"
          >
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-b-icon/20 px-3">
            <Link
              to="/"
              aria-label="SkinBattle home"
              className="flex items-center gap-2"
            >
              <CrownMark className="h-8 w-8" />
              <Wordmark className="text-lg" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="ml-auto flex h-10 w-10 cursor-pointer items-center justify-center bg-hextech-black/40 text-grey1 outline outline-icon/30 -outline-offset-1 transition duration-150 hover:text-gold1 hover:outline-icon"
            >
              <FontAwesomeIcon icon={faXmark} className="h-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
            <ul className="stagger flex flex-col gap-5">
              {SITE_SECTIONS.map((s) => (
                <DoorTile key={s.to} section={s} pathname={pathname} />
              ))}
            </ul>

            <div className="mt-8 border-t border-icon/20 pt-5">
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                {footerLinks.map((p) => (
                  <Link
                    key={`${p.to}-${p.label}`}
                    to={p.to}
                    search={p.linkSearch}
                    className="flex items-center gap-2 text-sm font-bold text-grey1 transition duration-150 hover:text-gold1"
                  >
                    <FontAwesomeIcon
                      icon={p.icon}
                      className="h-3.5 text-gold2/80"
                    />
                    {p.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          </div>,
          document.body,
        )}
    </>
  )
}
