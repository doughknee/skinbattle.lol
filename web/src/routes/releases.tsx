import { createFileRoute, Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faChevronDown,
  faRoad,
  faStar,
  faWrench,
} from '@fortawesome/free-solid-svg-icons'
import PageHeader from '~/components/PageHeader'
import { RELEASES, type ReleaseEntry } from '~/lib/releases'
import { btnSecondarySm } from '~/lib/ui'

export const Route = createFileRoute('/releases')({
  head: () => ({
    meta: [
      { title: 'Releases · Skin Battle' },
      {
        name: 'description',
        content:
          'What just shipped on skinbattle.lol, in plain language: new games, new rankings, and the fixes in between.',
      },
    ],
  }),
  component: ReleasesPage,
})

// Render the ISO date in UTC so the server and the browser agree on the day.
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function Entry({ entry }: { entry: ReleaseEntry }) {
  return (
    <li className="relative pb-12 pl-8 last:pb-0 sm:pl-12">
      {/* Timeline rail and node */}
      <span
        aria-hidden
        className="absolute left-[5px] top-2 bottom-0 w-px bg-gold5/50"
      />
      <span
        aria-hidden
        className="absolute left-0 top-1.5 h-[11px] w-[11px] rotate-45 bg-gold2 shadow-[0_0_10px_rgba(200,170,110,0.6)]"
      />

      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold2">
        {formatDate(entry.date)}
      </p>
      <h2 className="mt-1 font-serif text-2xl font-bold text-gold1 md:text-3xl">
        {entry.title}
      </h2>

      <ul className="mt-4 space-y-3">
        {entry.highlights.map((h) => (
          <li
            key={h}
            className="flex gap-3 bg-hextech-black/30 p-4 outline outline-icon/20 -outline-offset-2"
          >
            <FontAwesomeIcon
              icon={faStar}
              className="mt-1 h-3.5 shrink-0 text-gold2"
            />
            <p className="text-gold1/90">{h}</p>
          </li>
        ))}
      </ul>

      {entry.fixes.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm text-grey1 transition duration-150 hover:text-gold1 [&::-webkit-details-marker]:hidden">
            <FontAwesomeIcon icon={faWrench} className="h-3 shrink-0" />
            Also fixed ({entry.fixes.length})
            <FontAwesomeIcon
              icon={faChevronDown}
              className="h-2.5 shrink-0 transition duration-150 group-open:rotate-180"
            />
          </summary>
          <ul className="mt-2 space-y-1.5 border-l border-icon/20 pl-4">
            {entry.fixes.map((f) => (
              <li key={f} className="text-sm text-grey1">
                {f}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function ReleasesPage() {
  return (
    <div className="container mx-auto max-w-3xl px-6 pt-28 pb-16">
      <PageHeader
        eyebrow="Fresh off the forge"
        title="Releases"
        subtitle="What just shipped, in plain language. New toys up top, quiet fixes tucked below."
        className="mb-12"
      />

      <ol className="animate-fade-up">
        {RELEASES.map((entry, i) => (
          <Entry key={`${entry.date}-${i}`} entry={entry} />
        ))}
      </ol>

      <div className="animate-fade-up mt-14 flex flex-wrap items-center gap-3 border-t border-icon/20 pt-8">
        <p className="w-full text-sm text-grey1 sm:w-auto sm:flex-1">
          Curious where all this is heading?
        </p>
        <Link to="/roadmap" className={btnSecondarySm}>
          <FontAwesomeIcon icon={faRoad} className="h-4" />
          See the roadmap
        </Link>
      </div>
    </div>
  )
}
