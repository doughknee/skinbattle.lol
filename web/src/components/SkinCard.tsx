import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faBan } from '@fortawesome/free-solid-svg-icons'
import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { usePostHog } from 'posthog-js/react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { toast } from '~/components/Toaster'
import { openLightbox } from '~/components/Lightbox'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import { captureSkinVote } from '~/lib/analytics'
import type { Skin, VoteTotals } from '~/lib/types'

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
  // What the rank badge means here, e.g. "by battle rating in this wardrobe"
  // - shown as the badge tooltip. Rank meaning is contextual per page.
  rankContext?: string
}

const chipBase =
  'flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 text-sm font-bold outline -outline-offset-1 transition duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50'
const chipIdle =
  'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
const chipGoldActive = 'bg-gold5/30 text-gold1 outline-gold2'
const chipRedActive = 'bg-danger-surface/50 text-danger outline-danger-border/70'

export default function SkinCard({
  skin,
  championId,
  initialStar,
  initialX,
  showChampion = false,
  rank,
  rankContext,
}: SkinCardProps) {
  const { isAuthenticated, withApiToken, login } = useAuth()
  const posthog = usePostHog()

  const [totals, setTotals] = useState<VoteTotals>({
    total_stars: skin.total_stars || 0,
    total_x: skin.total_x || 0,
  })
  const [userStar, setUserStar] = useState<boolean>(initialStar ?? false)
  const [userX, setUserX] = useState<boolean>(initialX ?? false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setUserStar(initialStar ?? false)
    setUserX(initialX ?? false)
  }, [initialStar, initialX])

  const skinName = displaySkinName(skin.name, championId)
  const championName = championDisplayName(championId)

  // Optimistic vote with rollback: state (and totals) update immediately,
  // and revert to the pre-vote snapshot if the API call fails.
  const castVote = async (
    next: { star: boolean; x: boolean },
    onSuccess?: () => void,
  ) => {
    const prev = { star: userStar, x: userX, totals }
    setUserStar(next.star)
    setUserX(next.x)
    setTotals({
      total_stars:
        prev.totals.total_stars + (next.star ? 1 : 0) - (prev.star ? 1 : 0),
      total_x: prev.totals.total_x + (next.x ? 1 : 0) - (prev.x ? 1 : 0),
    })
    setPending(true)
    try {
      const data = await withApiToken(
        (token) =>
          api.vote({ skinId: skin.id, star: next.star, x: next.x }, token),
        'Please sign in to vote.',
      )
      if (data.totals) setTotals(data.totals)
      onSuccess?.()
      window.dispatchEvent(new CustomEvent('updateUserStats'))
    } catch (err) {
      setUserStar(prev.star)
      setUserX(prev.x)
      setTotals(prev.totals)
      toast(err instanceof Error ? err.message : 'Vote failed', 'error')
    } finally {
      setPending(false)
    }
  }

  const handleStar = () => {
    const newStar = !userStar
    if (newStar && userStatsStore.get().usedStars >= MAX_STARS) {
      toast(
        `All ${MAX_STARS} stars used. Unstar another skin first.`,
        'error',
      )
      return
    }
    castVote({ star: newStar, x: userX }, () => {
      userStatsStore.adjust({ stars: newStar ? 1 : -1 })
      const used = userStatsStore.get().usedStars
      captureSkinVote(posthog, newStar ? 'star' : 'unstar', {
        skinId: skin.id,
        skinName,
        championId,
        used,
        source: 'skin_card',
      })
      toast(
        newStar
          ? `Star ${used}/${MAX_STARS} used`
          : `Star removed. ${used}/${MAX_STARS} used`,
        'success',
      )
    })
  }

  const handleX = () => {
    const newX = !userX
    if (newX && userStatsStore.get().usedX >= MAX_X) {
      toast(`All ${MAX_X} bans used. Unban another skin first.`, 'error')
      return
    }
    castVote({ star: userStar, x: newX }, () => {
      userStatsStore.adjust({ x: newX ? 1 : -1 })
      const used = userStatsStore.get().usedX
      captureSkinVote(posthog, newX ? 'ban' : 'unban', {
        skinId: skin.id,
        skinName,
        championId,
        used,
        source: 'skin_card',
      })
      toast(
        newX
          ? `Ban ${used}/${MAX_X} used`
          : `Ban removed. ${used}/${MAX_X} used`,
        'success',
      )
    })
  }

  return (
    <div className="group relative flex h-full flex-col bg-hextech-black/30 transition duration-300 hover:shadow-glow">
      {/* Border drawn on an overlay so it stays visible over the splash art -
          the image's hover transform otherwise paints above an inset outline.
          Offset -1 keeps it flush with the edge so the image sits inside it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 outline outline-icon/25 -outline-offset-1 transition duration-300 group-hover:outline-icon"
      />
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
        className="relative block w-full aspect-video cursor-zoom-in overflow-hidden"
      >
        <img
          src={skin.splash_url}
          alt={`${skinName} splash art`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {rank != null && (
          <span
            aria-label={`Ranked #${rank}`}
            title={rankContext ? `#${rank} ${rankContext}` : undefined}
            className={`absolute left-2 top-2 bg-hextech-black/85 px-2 py-0.5 font-serif text-sm font-bold outline -outline-offset-1 ${
              rank === 1
                ? 'text-gold2 outline-gold2'
                : 'text-gold1 outline-gold5'
            }`}
          >
            #{rank}
          </span>
        )}
      </button>

      {/* flex-1 absorbs row-height differences from wrapping names, so the
          vote controls stay bottom-aligned across a row of cards. */}
      <div className="flex flex-1 flex-col items-center justify-center px-3 pt-3 text-center">
        {showChampion && (
          <Link
            to="/champions/$id"
            params={{ id: championId.toLowerCase() }}
            className="text-xs font-semibold uppercase tracking-widest text-gold2/80 hover:text-gold2 transition duration-150"
          >
            {championName}
          </Link>
        )}
        <p className="font-serif text-lg text-grey1">{skinName}</p>
      </div>

      {isAuthenticated ? (
        <div className="@container p-3">
          <div className="flex gap-1.5">
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
                userStar
                  ? 'Remove star'
                  : `Star this skin. You only get ${MAX_STARS}`
              }
              className={`${chipBase} ${userStar ? chipGoldActive : chipIdle}`}
            >
              <FontAwesomeIcon icon={faStar} className="h-3.5" />
              <span className="tabular-nums">{totals.total_stars}</span>
              <span className="hidden @[21rem]:inline">
                {userStar ? 'Starred' : 'Star'}
              </span>
            </button>
            <button
              onClick={handleX}
              disabled={pending}
              aria-label={
                userX ? `Unban ${skinName}` : `Ban ${skinName} (${MAX_X} max)`
              }
              aria-pressed={userX}
              title={
                userX ? 'Remove ban' : `Ban this skin. You only get ${MAX_X}`
              }
              className={`${chipBase} ${userX ? chipRedActive : chipIdle}`}
            >
              <FontAwesomeIcon icon={faBan} className="h-3.5" />
              <span className="tabular-nums">{totals.total_x}</span>
              <span className="hidden @[21rem]:inline">
                {userX ? 'Banned' : 'Ban'}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="mb-2 flex items-center justify-center gap-4 text-sm text-grey1 tabular-nums">
            <span title="Stars">
              <FontAwesomeIcon icon={faStar} className="mr-1.5 h-3" />
              {totals.total_stars}
            </span>
            <span title="Bans">
              <FontAwesomeIcon icon={faBan} className="mr-1.5 h-3" />
              {totals.total_x}
            </span>
          </div>
          <button
            onClick={() => {
              // Sign-in intent from the catalog - the activation funnel's
              // missing first step, captured before the redirect.
              posthog.capture('auth_prompt_clicked', {
                trigger: 'star_ban_gate',
                source: 'skin_card',
                skin_id: skin.id,
              })
              login()
            }}
            aria-label={`Sign in to vote on ${skinName}`}
            className="h-10 w-full cursor-pointer bg-gold5/20 text-sm font-bold text-gold1 outline outline-gold2/50 -outline-offset-1 hover:bg-gold5/40 hover:outline-gold2 transition duration-150"
          >
            Sign in to vote
          </button>
        </div>
      )}
    </div>
  )
}
