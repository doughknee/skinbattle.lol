import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { CrownMark, Wordmark } from './Brand'
import { openCommandPalette } from './CommandPalette'
import { FOOTER_COLUMNS, type SitePage } from '~/lib/siteMap'
import { SUPPORT_URL } from '~/lib/support'

// The honeyfruit: League's healing fruit, standing in for "buy me a coffee"
// - the site is free, so the support ask is one quiet line in the basement.
function HoneyfruitIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="8" cy="9.5" r="5.5" fill="#e87da0" />
      <path d="M8 4.5C8 2.5 9.5 1.2 11.2 1.2 11.2 3.4 9.8 4.6 8 4.5Z" fill="#7ac74f" />
      <circle cx="6.2" cy="8.2" r="1.1" fill="#f6b8cd" />
    </svg>
  )
}

// The footer is the full sitemap, curated into intent columns (siteMap.ts).
// Everything the lean three-door navbar leaves out lives here.

function Column({
  title,
  pages,
  extra,
}: {
  title: string
  pages: SitePage[]
  extra?: ReactNode
}) {
  return (
    <nav aria-label={`Footer: ${title}`}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold2">
        {title}
      </p>
      <ul className="space-y-2 text-sm">
        {pages.map((p) => (
          // Tab links share a pathname (/profile), so the key needs the label.
          <li key={`${p.to}-${p.label}`}>
            <Link
              to={p.to}
              search={p.linkSearch}
              className="text-grey1 hover:text-gold1 transition duration-150"
            >
              {p.label}
            </Link>
          </li>
        ))}
        {extra}
      </ul>
    </nav>
  )
}

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-icon/20 bg-hextech-black/40">
      <div className="container mx-auto grid gap-10 px-6 py-12 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-2.5">
            <CrownMark className="h-9 w-9" />
            <Wordmark className="text-lg" />
          </p>
          <p className="mt-3 max-w-xs text-sm text-grey1">
            Vote, rank, and find your taste in League of Legends skins.
          </p>
        </div>

        {FOOTER_COLUMNS.map((col) => (
          <Column
            key={col.title}
            title={col.title}
            pages={col.pages}
            // Search is a ⌘K action, not a page - it rides in the Explore column.
            extra={
              col.title === 'Explore' ? (
                <li>
                  <button
                    type="button"
                    onClick={openCommandPalette}
                    className="flex items-center gap-2 text-grey1 transition duration-150 hover:text-gold1"
                  >
                    <FontAwesomeIcon
                      icon={faMagnifyingGlass}
                      className="h-3 text-gold2"
                    />
                    Search
                  </button>
                </li>
              ) : undefined
            }
          />
        ))}
      </div>

      <div className="container mx-auto px-6 pb-8">
        <p className="max-w-3xl text-xs leading-relaxed text-grey1/80">
          skinbattle.lol isn't endorsed by Riot Games and doesn't reflect the
          views or opinions of Riot Games or anyone officially involved in
          producing or managing Riot Games properties. Riot Games and all
          associated properties are trademarks or registered trademarks of Riot
          Games, Inc. Splash art is the property of Riot Games.
        </p>
      </div>
      <div className="border-t border-icon/10 py-4 text-center text-xs text-grey1/70">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6">
          <span>© {new Date().getFullYear()} skinbattle.lol</span>
          <span aria-hidden>·</span>
          <span>not affiliated with or endorsed by Riot Games</span>
          <span aria-hidden>·</span>
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 transition duration-150 hover:text-gold1"
          >
            <HoneyfruitIcon className="h-3.5 w-3.5 transition duration-150 group-hover:scale-125" />
            runs on honeyfruit, toss one
          </a>
        </p>
      </div>
    </footer>
  )
}
