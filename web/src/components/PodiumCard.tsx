import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCrown } from '@fortawesome/free-solid-svg-icons'
import type { RankingRow } from '~/lib/games/types'

const n = (v: number): string => v.toLocaleString('en-US')

// Top 3 of a narrow ranking slice: full splash-art cards. #1 takes the whole
// row at a cinematic crop; #2 and #3 share the next one. Splashes keep their
// subjects in the upper middle, so wide crops anchor near the top.
//
// Recovered from the pre-table layout (e9bdc78^). The rating carries its
// uncertainty band, as it does in the table below: the old battle-count
// "confidence hint" is not restored because it said "solid" off battles alone,
// which is exactly the reading the voter-aware verdict now refuses to make.
export default function PodiumCard({ row }: { row: RankingRow }) {
  const first = row.rank === 1
  return (
    <Link
      to="/skins/$slug"
      params={{ slug: row.slug }}
      className={`card-sheen-host group relative block overflow-hidden bg-hextech-black/60 transition duration-200 hover:shadow-glow ${
        first ? 'sm:col-span-2' : ''
      }`}
    >
      <img
        src={row.splashUrl}
        alt={row.name}
        loading={first ? 'eager' : 'lazy'}
        decoding="async"
        className={`w-full object-cover object-[50%_25%] transition duration-300 ease-out group-hover:scale-[1.03] group-hover:brightness-110 group-hover:saturate-[1.06] ${
          first
            ? 'aspect-[16/10] sm:aspect-[21/9]'
            : 'aspect-[16/10] sm:aspect-video'
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-hextech-black/95 via-hextech-black/25 to-transparent" />
      {/* The light rake: over the splash + gradient, under the badge/title/frame. */}
      <span aria-hidden className="card-sheen" />
      <span
        className={`absolute left-3 top-3 flex items-center gap-1.5 px-2.5 py-1 font-serif text-sm font-bold outline -outline-offset-1 ${
          first
            ? 'bg-gold5/80 text-gold1 outline-gold2'
            : 'bg-hextech-black/75 text-gold1 outline-icon/40'
        }`}
      >
        {first && <FontAwesomeIcon icon={faCrown} className="h-3.5" />}#
        {row.rank}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p
          className={`text-shadow-hero truncate font-serif font-bold text-gold1 transition duration-150 group-hover:text-gold2 ${
            first ? 'text-2xl md:text-4xl' : 'text-xl md:text-2xl'
          }`}
        >
          {row.name}
        </p>
        <div className="mt-0.5 flex items-end justify-between gap-4">
          <p className="text-shadow-hero min-w-0 truncate text-sm text-grey1">
            {row.championName}
            {row.cost !== null && <> · {n(row.cost)} RP</>}
          </p>
          <p
            className={`text-shadow-hero shrink-0 whitespace-nowrap font-serif font-bold text-gold1 ${
              first ? 'text-3xl md:text-4xl' : 'text-2xl'
            }`}
          >
            {n(row.rating)}
            <span className="ml-1 font-sans text-xs font-normal text-grey1">
              ±{n(row.uncertainty)}
            </span>
          </p>
        </div>
      </div>
      {/* Frame on its own overlay above the splash, so the hover zoom can't
          paint over it. #1 keeps its standing gold edge; all of them ignite
          to full gold. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-10 outline -outline-offset-1 transition duration-200 group-hover:outline-gold2 ${
          first ? 'outline-gold2/60' : 'outline-icon/25'
        }`}
      />
    </Link>
  )
}
