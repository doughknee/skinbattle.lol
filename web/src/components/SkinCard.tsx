import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUp,
  faArrowDown,
  faStar,
  faBan,
} from '@fortawesome/free-solid-svg-icons'
import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { toast } from '~/components/Toaster'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import type { Skin, VoteTotals } from '~/lib/types'

interface SkinCardProps {
  skin: Skin
  championId: string
  initialVote?: number
  initialStar?: boolean
  initialX?: boolean
  // Show the champion name above the skin name — used on pages that mix
  // skins from many champions (home, awards, my votes).
  showChampion?: boolean
}

const chipBase =
  'flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 text-sm font-bold outline -outline-offset-1 transition duration-150 disabled:cursor-not-allowed disabled:opacity-50'
const chipIdle =
  'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
const chipGoldActive = 'bg-gold5/30 text-gold1 outline-gold2'
const chipBlueActive = 'bg-blue5/60 text-blue1 outline-blue3'
const chipRedActive = 'bg-red-950/50 text-red-300 outline-red-400/70'

export default function SkinCard({
  skin,
  championId,
  initialVote,
  initialStar,
  initialX,
  showChampion = false,
}: SkinCardProps) {
  const { isAuthenticated, getApiToken, login } = useAuth()

  const [totals, setTotals] = useState<VoteTotals>({
    total_votes: skin.total_votes || 0,
    total_stars: skin.total_stars || 0,
    total_x: skin.total_x || 0,
  })
  const [userVote, setUserVote] = useState<number>(initialVote ?? 0)
  const [userStar, setUserStar] = useState<boolean>(initialStar ?? false)
  const [userX, setUserX] = useState<boolean>(initialX ?? false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setUserVote(initialVote ?? 0)
    setUserStar(initialStar ?? false)
    setUserX(initialX ?? false)
  }, [initialVote, initialStar, initialX])

  const skinName = displaySkinName(skin.name, championId)
  const championName = championDisplayName(championId)

  // Optimistic vote with rollback: state (and totals) update immediately,
  // and revert to the pre-vote snapshot if the API call fails.
  const castVote = async (
    next: { vote: number; star: boolean; x: boolean },
    onSuccess?: () => void,
  ) => {
    const prev = { vote: userVote, star: userStar, x: userX, totals }
    setUserVote(next.vote)
    setUserStar(next.star)
    setUserX(next.x)
    setTotals({
      total_votes: prev.totals.total_votes + (next.vote - prev.vote),
      total_stars:
        prev.totals.total_stars + (next.star ? 1 : 0) - (prev.star ? 1 : 0),
      total_x: prev.totals.total_x + (next.x ? 1 : 0) - (prev.x ? 1 : 0),
    })
    setPending(true)
    try {
      const token = await getApiToken()
      if (!token) throw new Error('Please sign in to vote.')
      const data = await api.vote(
        {
          skinId: skin.id,
          vote: next.vote as -1 | 0 | 1,
          star: next.star,
          x: next.x,
        },
        token,
      )
      if (data.totals) setTotals(data.totals)
      onSuccess?.()
      window.dispatchEvent(new CustomEvent('updateUserStats'))
    } catch (err) {
      setUserVote(prev.vote)
      setUserStar(prev.star)
      setUserX(prev.x)
      setTotals(prev.totals)
      toast(err instanceof Error ? err.message : 'Vote failed', 'error')
    } finally {
      setPending(false)
    }
  }

  const handleUpvote = () => {
    castVote({ vote: userVote === 1 ? 0 : 1, star: userStar, x: userX })
  }

  const handleDownvote = () => {
    castVote({ vote: userVote === -1 ? 0 : -1, star: userStar, x: userX })
  }

  const handleStar = () => {
    const newStar = !userStar
    if (newStar && userStatsStore.get().usedStars >= MAX_STARS) {
      toast(
        `All ${MAX_STARS} stars used — unstar another skin first.`,
        'error',
      )
      return
    }
    castVote({ vote: userVote, star: newStar, x: userX }, () => {
      userStatsStore.adjust({ stars: newStar ? 1 : -1 })
      const used = userStatsStore.get().usedStars
      toast(
        newStar
          ? `Star ${used}/${MAX_STARS} used`
          : `Star removed — ${used}/${MAX_STARS} used`,
        'success',
      )
    })
  }

  const handleX = () => {
    const newX = !userX
    if (newX && userStatsStore.get().usedX >= MAX_X) {
      toast(`All ${MAX_X} bans used — unban another skin first.`, 'error')
      return
    }
    castVote({ vote: userVote, star: userStar, x: newX }, () => {
      userStatsStore.adjust({ x: newX ? 1 : -1 })
      const used = userStatsStore.get().usedX
      toast(
        newX
          ? `Ban ${used}/${MAX_X} used`
          : `Ban removed — ${used}/${MAX_X} used`,
        'success',
      )
    })
  }

  return (
    <div className="group bg-hextech-black/30 border-2 border-transparent outline-icon/30 outline -outline-offset-2 hover:border-icon hover:border-2 transition duration-150">
      <div className="relative w-full aspect-video overflow-hidden">
        <img
          src={skin.splash_url}
          alt={`${skinName} splash art`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>

      <div className="px-3 pt-3 text-center">
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
              onClick={handleUpvote}
              disabled={pending}
              aria-label={`Upvote ${skinName}`}
              aria-pressed={userVote === 1}
              title={userVote === 1 ? 'Remove upvote' : 'Upvote'}
              className={`${chipBase} ${userVote === 1 ? chipGoldActive : chipIdle}`}
            >
              <FontAwesomeIcon icon={faArrowUp} className="h-3.5" />
              <span className="tabular-nums">{totals.total_votes}</span>
            </button>
            <button
              onClick={handleDownvote}
              disabled={pending}
              aria-label={`Downvote ${skinName}`}
              aria-pressed={userVote === -1}
              title={userVote === -1 ? 'Remove downvote' : 'Downvote'}
              className={`${chipBase} ${userVote === -1 ? chipBlueActive : chipIdle}`}
            >
              <FontAwesomeIcon icon={faArrowDown} className="h-3.5" />
            </button>
            <button
              onClick={handleStar}
              disabled={pending}
              aria-label={
                userStar ? `Unstar ${skinName}` : `Star ${skinName} (3 max)`
              }
              aria-pressed={userStar}
              title={
                userStar
                  ? 'Remove star'
                  : 'Star this skin — you only get 3'
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
                userX ? `Unban ${skinName}` : `Ban ${skinName} (3 max)`
              }
              aria-pressed={userX}
              title={userX ? 'Remove ban' : 'Ban this skin — you only get 3'}
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
            <span title="Community votes">
              <FontAwesomeIcon icon={faArrowUp} className="mr-1.5 h-3" />
              {totals.total_votes}
            </span>
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
            onClick={login}
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
