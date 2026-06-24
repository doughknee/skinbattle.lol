import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlassPlus } from '@fortawesome/free-solid-svg-icons'
import { Link } from '@tanstack/react-router'
import { openLightbox } from '~/components/Lightbox'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import { skinSlug } from '~/lib/games/slug'
import { fallbackToRaw, skinThumb } from '~/lib/img'
import type { Skin } from '~/lib/types'

interface SkinCardProps {
  skin: Skin
  championId: string
  // Show the champion name above the skin name - used on pages that mix
  // skins from many champions (home, rankings).
  showChampion?: boolean
  // Leaderboard position badge overlaid on the splash (#1, #2, ...).
  rank?: number
  // What the rank badge means here, e.g. "by battle rating in this wardrobe".
  rankContext?: string
}

// A rankings tile: splash, optional rank badge, name. The splash leads to the
// skin's page; a hover-revealed button zooms the full art.

// Reveal-on-hover, with a touch fallback (no :hover → show always).
const reveal =
  'opacity-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-100 group-hover:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto'

export default function SkinCard({
  skin,
  championId,
  showChampion = false,
  rank,
  rankContext,
}: SkinCardProps) {
  const skinName = displaySkinName(skin.name, championId)
  const championName = championDisplayName(championId)
  const slug = skinSlug(skin.name, skin.id)

  return (
    <div className="card-sheen-host group relative aspect-video overflow-hidden bg-hextech-black/40 transition duration-300 hover:shadow-glow">
      {/* Splash is the click target - it leads to the skin's page. */}
      <Link
        to="/skins/$slug"
        params={{ slug }}
        aria-label={`${skinName} details`}
        className="absolute inset-0 z-0 block"
      >
        <img
          src={skinThumb(skin.splash_url, 768)}
          data-raw={skin.splash_url}
          onError={fallbackToRaw}
          alt={`${skinName} splash art`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-[50%_22%] transition duration-500 ease-out group-hover:scale-105 group-hover:brightness-110 group-hover:saturate-[1.06]"
        />
      </Link>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-hextech-black via-hextech-black/30 to-transparent"
      />
      {/* Gold light rake on hover. */}
      <span aria-hidden className="card-sheen" />
      {/* Frame on its own overlay so the hover zoom can't paint over it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 outline outline-icon/25 -outline-offset-1 transition duration-300 group-hover:outline-gold2"
      />

      {rank != null && (
        <span
          aria-label={`Ranked #${rank}`}
          title={rankContext ? `#${rank} ${rankContext}` : undefined}
          className={`pointer-events-none absolute left-2 top-2 z-20 bg-hextech-black/85 px-2 py-0.5 font-serif text-sm font-bold outline -outline-offset-1 ${
            rank === 1 ? 'text-gold2 outline-gold2' : 'text-gold1 outline-gold5'
          }`}
        >
          #{rank}
        </span>
      )}

      {/* Zoom to the full splash - revealed on hover, not stamped on every card. */}
      <button
        type="button"
        onClick={() =>
          openLightbox({
            url: skin.splash_url,
            title: skinName,
            subtitle: championName,
          })
        }
        aria-label={`View ${skinName} splash art full screen`}
        title="View full splash art"
        className={`absolute right-2 top-2 z-20 flex h-8 w-8 cursor-zoom-in items-center justify-center bg-hextech-black/75 text-grey1 outline outline-icon/30 -outline-offset-1 backdrop-blur-sm hover:text-gold1 hover:outline-gold2 ${reveal}`}
      >
        <FontAwesomeIcon icon={faMagnifyingGlassPlus} className="h-3.5" />
      </button>

      {/* Bottom plate: champion (optional) + name. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-2.5">
        {showChampion && (
          <Link
            to="/champions/$id"
            params={{ id: championId.toLowerCase() }}
            className="text-shadow-hero pointer-events-auto block text-xs font-semibold uppercase tracking-widest text-gold2/90 transition duration-150 hover:text-gold2"
          >
            {championName}
          </Link>
        )}
        <p className="text-shadow-hero truncate font-serif text-base font-bold text-gold1">
          {skinName}
        </p>
      </div>
    </div>
  )
}
