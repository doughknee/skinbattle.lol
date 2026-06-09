import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUp,
  faArrowDown,
  faStar,
  faBan,
} from '@fortawesome/free-solid-svg-icons'
import { useState, useEffect } from 'react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import type { Skin, VoteTotals } from '~/lib/types'

interface SkinCardProps {
  skin: Skin
  championId: string
  initialVote?: number
  initialStar?: boolean
  initialX?: boolean
}

export default function SkinCard({
  skin,
  championId,
  initialVote,
  initialStar,
  initialX,
}: SkinCardProps) {
  const { isAuthenticated, getApiToken } = useAuth()

  const [totals, setTotals] = useState<VoteTotals>({
    total_votes: skin.total_votes || 0,
    total_stars: skin.total_stars || 0,
    total_x: skin.total_x || 0,
  })
  const [userVote, setUserVote] = useState<number>(initialVote ?? 0)
  const [userStar, setUserStar] = useState<boolean>(initialStar ?? false)
  const [userX, setUserX] = useState<boolean>(initialX ?? false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    setUserVote(initialVote ?? 0)
    setUserStar(initialStar ?? false)
    setUserX(initialX ?? false)
  }, [initialVote, initialStar, initialX])

  const sendVote = async (vote: number, star: boolean, x: boolean) => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const token = await getApiToken()
      if (!token) throw new Error('Please log in to vote.')
      const data = await api.vote(
        { skinId: skin.id, vote: vote as -1 | 0 | 1, star, x },
        token,
      )
      if (data.totals) {
        setTotals(data.totals)
      }
      window.dispatchEvent(new CustomEvent('updateUserStats'))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vote failed')
    } finally {
      setLoading(false)
    }
  }

  const requireAuth = (): boolean => {
    if (!isAuthenticated) {
      setErrorMsg('Please log in to vote.')
      return false
    }
    return true
  }

  const handleUpvote = () => {
    if (!requireAuth()) return
    const newVote = userVote === 1 ? 0 : 1
    setUserVote(newVote)
    sendVote(newVote, userStar, userX)
  }

  const handleDownvote = () => {
    if (!requireAuth()) return
    const newVote = userVote === -1 ? 0 : -1
    setUserVote(newVote)
    sendVote(newVote, userStar, userX)
  }

  const handleStar = () => {
    if (!requireAuth()) return
    const newStar = !userStar
    setUserStar(newStar)
    sendVote(userVote, newStar, userX)
  }

  const handleX = () => {
    if (!requireAuth()) return
    const newX = !userX
    setUserX(newX)
    sendVote(userVote, userStar, newX)
  }

  return (
    <div className="group bg-hextech-black/30 border-2 border-transparent outline-icon/30 outline -outline-offset-2 hover:border-icon hover:border-2 transition duration-150">
      <div className="relative w-full aspect-video overflow-hidden">
        <img
          src={skin.splash_url}
          alt={`${championId} ${skin.name}`}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <p className="font-serif text-lg text-grey1 text-center pt-4">{skin.name}</p>
      <div className="flex justify-evenly items-center p-4">
        <div className="flex justify-center items-center space-x-2">
          <div className="mr-2 text-gold1 font-bold text-2xl mb-1">
            {totals.total_votes}
          </div>
          <button
            onClick={handleUpvote}
            disabled={loading}
            className="cursor-pointer p-1"
          >
            <FontAwesomeIcon
              icon={faArrowUp}
              className={`${userVote === 1 ? 'text-gold3' : 'text-grey2'} hover:text-gold3 hover:scale-105 transition duration-150`}
            />
          </button>
          <button
            onClick={handleDownvote}
            disabled={loading}
            className="cursor-pointer p-1"
          >
            <FontAwesomeIcon
              icon={faArrowDown}
              className={`${userVote === -1 ? 'text-gold3' : 'text-grey2'} hover:text-gold3 hover:scale-105 transition duration-150`}
            />
          </button>
        </div>
        <div className="flex justify-center items-center space-x-2">
          <div className="mr-2 text-gold1 font-bold text-2xl mb-1">
            {totals.total_stars}
          </div>
          <button
            onClick={handleStar}
            disabled={loading}
            className="cursor-pointer p-1"
          >
            <FontAwesomeIcon
              icon={faStar}
              className={`${userStar ? 'text-gold3' : 'text-grey2'} hover:text-gold3 hover:scale-105 transition duration-150`}
            />
          </button>
        </div>
        <div className="flex justify-center items-center space-x-2">
          <div className="mr-2 text-gold1 font-bold text-2xl mb-1">
            {totals.total_x}
          </div>
          <button
            onClick={handleX}
            disabled={loading}
            className="cursor-pointer p-1"
          >
            <FontAwesomeIcon
              icon={faBan}
              className={`${userX ? 'text-gold3' : 'text-grey2'} hover:text-gold3 hover:scale-105 transition duration-150`}
            />
          </button>
        </div>
      </div>
      {errorMsg && <p className="text-red-500 text-center mt-2">{errorMsg}</p>}
    </div>
  )
}
