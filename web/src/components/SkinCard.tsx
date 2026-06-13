import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBan,
  faMagnifyingGlassPlus,
  faStar,
} from '@fortawesome/free-solid-svg-icons'
import { Link } from '@tanstack/react-router'
import { openLightbox } from '~/components/Lightbox'
import { useSkinVote } from '~/lib/useSkinVote'
import { MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import { skinSlug } from '~/lib/games/slug'
import type { Skin } from '~/lib/types'

interface SkinCardProps {
  skin: Skin
  championId: string
  initialStar?: boolean
  initialX?: boolean
  // Show the champion name above the skin name - used on pages that mix
  // skins from many champions (home, awards, my votes).
  showChampion?: boolean
  // Leaderboard position badge overlaid on the splash (#1, #2, ...).
  rank?: number
  // What the rank badge means here, e.g. "by battle rating in this wardrobe".
  rankContext?: string
}

// The card reads like a rankings tile at rest - splash, name, quiet tallies -
// and only reveals its controls on hover (or always, on touch, where there's
// no hover). One overlaid language, shared with the rankings page.
const chip =
  'flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 bg-hextech-black/75 text-sm font-bold outline -outline-offset-1 backdrop-blur-sm transition duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50'
const chipIdle = 'text-gold1 outline-icon/40 hover:bg-hextech-black/90 hover:outline-gold2'
const chipStarOn = 'bg-gold5/50 text-gold1 outline-gold2'
const chipBanOn = 'bg-danger-surface/60 text-danger outline-danger-border/80'

// Reveal-on-hover, with a touch fallback (no :hover → show always).
const reveal =
  'opacity-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-100 group-hover:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto'

export default function SkinCard({
  skin,
  championId,
  initialStar,
  initialX,
  showChampion = false,
  rank,
  rankContext,
}: SkinCardProps) {
  const skinName = displaySkinName(skin.name, championId)
  const championName = championDisplayName(championId)
  const slug = skinSlug(skin.name, skin.id)

  const { totals, userStar, userX, pending, handleStar, handleX } = useSkinVote(
    {
      skinId: skin.id,
      championId,
      skinName,
      baseStars: skin.total_stars,
      baseBans: skin.total_x,
      initialStar,
      initialX,
      source: 'skin_card',
    },
  )

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
          src={skin.splash_url}
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

      {/* Bottom plate: name (always), tallies at rest swapping to live controls. */}
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

        <div className="relative mt-1.5 h-8">
          {/* Resting state: quiet community tallies. */}
          <div className="pointer-events-none absolute inset-0 flex items-center gap-3 text-sm tabular-nums text-gold1/90 transition-opacity duration-200 group-hover:opacity-0 [@media(hover:none)]:hidden">
            <span className="text-shadow-hero" title="Stars">
              <FontAwesomeIcon icon={faStar} className="mr-1 h-3 text-gold2" />
              {totals.total_stars}
            </span>
            <span className="text-shadow-hero" title="Bans">
              <FontAwesomeIcon icon={faBan} className="mr-1 h-3 text-danger" />
              {totals.total_x}
            </span>
          </div>

          {/* Hover/touch: the live star + ban controls. */}
          <div className={`absolute inset-0 flex gap-1.5 ${reveal}`}>
            <button
              onClick={handleStar}
              disabled={pending}
              aria-label={
                userStar
                  ? `Unstar ${skinName}`
                  : `Star ${skinName} (${MAX_STARS} max)`
              }
              aria-pressed={userStar}
              title={
                userStar ? 'Remove star' : `Star this skin. You only get ${MAX_STARS}`
              }
              className={`${chip} ${userStar ? chipStarOn : chipIdle}`}
            >
              <FontAwesomeIcon icon={faStar} className="h-3.5" />
              <span className="tabular-nums">{totals.total_stars}</span>
            </button>
            <button
              onClick={handleX}
              disabled={pending}
              aria-label={
                userX ? `Unban ${skinName}` : `Ban ${skinName} (${MAX_X} max)`
              }
              aria-pressed={userX}
              title={userX ? 'Remove ban' : `Ban this skin. You only get ${MAX_X}`}
              className={`${chip} ${userX ? chipBanOn : chipIdle}`}
            >
              <FontAwesomeIcon icon={faBan} className="h-3.5" />
              <span className="tabular-nums">{totals.total_x}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
