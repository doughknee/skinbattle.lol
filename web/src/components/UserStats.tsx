import { useState, useEffect, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faBan } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'

export default function UserStats() {
  const { isAuthenticated, getApiToken } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ usedStars: 0, usedX: 0 })
  const [showTooltip, setShowTooltip] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      setError(null)
      const token = await getApiToken()
      // Not logged in → default stats (mirrors the old 401 handling).
      if (!token) {
        setStats({ usedStars: 0, usedX: 0 })
        return
      }
      const data = await api.userStats(token)
      setStats({
        usedStars: data.usedStars || 0,
        usedX: data.usedX || 0,
      })
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to fetch stats')
    }
  }, [getApiToken])

  useEffect(() => {
    fetchStats()

    const handleUpdate = () => {
      fetchStats()
    }
    window.addEventListener('updateUserStats', handleUpdate)
    return () => {
      window.removeEventListener('updateUserStats', handleUpdate)
    }
  }, [fetchStats, isAuthenticated])

  if (error) {
    return null
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="p-4 bg-gold2 text-blue5 cursor-default flex items-center w-44">
        {stats.usedStars}/3 <FontAwesomeIcon icon={faStar} className="px-2" />
        &nbsp;|&nbsp;
        <FontAwesomeIcon icon={faBan} className="px-2" /> {stats.usedX}/3
      </div>

      {showTooltip && (
        <div className="absolute right-0 bottom-15 w-44 outline outline-gold2/30 p-2 bg-hextech-black text-gold1 text-sm shadow-md">
          <p className="mb-1">• Stars = skins you absolutely love!</p>
          <p>• Bans = skins you hate with a passion.</p>
        </div>
      )}
    </div>
  )
}
