import { Link } from '@tanstack/react-router'
import { CrownMark, Wordmark } from './Brand'
import {
  PROFILE,
  SECONDARY_PAGES,
  SITE_SECTIONS,
  type SitePage,
} from '~/lib/siteMap'

// The footer is the full sitemap, rendered from the site-map registry - one
// column per top-level section. New registry entries appear here for free.

function Column({ title, pages }: { title: string; pages: SitePage[] }) {
  return (
    <nav aria-label={`Footer: ${title}`}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold2">
        {title}
      </p>
      <ul className="space-y-2 text-sm">
        {pages.map((p) => (
          <li key={p.to}>
            <Link
              to={p.to}
              className="text-grey1 hover:text-gold1 transition duration-150"
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function Footer() {
  // Each section with children gets its own column; anything childless plus
  // the profile link groups into a final "You" column.
  const you = [...SITE_SECTIONS.filter((s) => !s.children?.length), PROFILE]
  const grouped = SITE_SECTIONS.filter((s) => (s.children?.length ?? 0) > 0)

  return (
    <footer className="mt-24 border-t border-icon/20 bg-hextech-black/40">
      <div className="container mx-auto grid gap-10 px-6 py-12 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_0.9fr_0.9fr]">
        <div>
          <p className="flex items-center gap-2.5">
            <CrownMark className="h-9 w-9" />
            <Wordmark className="text-lg" />
          </p>
          <p className="mt-3 max-w-xs text-sm text-grey1">
            Community-built rankings for every League of Legends skin. Battle,
            star, and ban your way to the definitive list.
          </p>
        </div>

        {grouped.map((s) => {
          // Section landing first, children after - minus any child that
          // points back at the landing page (e.g. "Browse the Slices").
          const pages = [s, ...s.children!.filter((c) => c.to !== s.to)]
          return <Column key={s.to} title={s.label} pages={pages} />
        })}
        <Column title="You" pages={you} />
        <Column title="The Site" pages={SECONDARY_PAGES} />
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
        © {new Date().getFullYear()} skinbattle.lol
      </div>
    </footer>
  )
}
