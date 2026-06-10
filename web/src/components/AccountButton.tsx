import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightToBracket, faUserGear } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'

// Cache the username across mounts so navigation doesn't refetch /me.
let cachedUsername: string | null = null

export default function AccountButton() {
  const navigate = useNavigate()
  const { isAuthenticated, getApiToken, login } = useAuth()
  const [username, setUsername] = useState<string | null>(cachedUsername)

  useEffect(() => {
    if (!isAuthenticated) {
      cachedUsername = null
      setUsername(null)
      return
    }
    if (cachedUsername) {
      setUsername(cachedUsername)
      return
    }
    let cancelled = false
    ;(async () => {
      const token = await getApiToken()
      if (!token) return
      try {
        const me = await api.me(token)
        if (!cancelled && me?.username) {
          cachedUsername = me.username
          setUsername(me.username)
        }
      } catch {
        /* fall back to the generic "Account" label */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getApiToken])

  const label = isAuthenticated ? (username ?? 'Account') : 'Sign in'

  return (
    <button
      onClick={() => {
        if (isAuthenticated) {
          navigate({ to: '/account' })
        } else {
          login()
        }
      }}
      type="button"
      aria-label={isAuthenticated ? `Account: ${label}` : 'Sign in'}
      title={isAuthenticated ? 'Account settings' : 'Sign in'}
      className="flex h-10 cursor-pointer items-center gap-2 bg-hextech-black/40 px-3 text-sm font-bold text-grey1 outline outline-icon/30 -outline-offset-1 hover:text-gold1 hover:outline-icon transition duration-150"
    >
      <FontAwesomeIcon
        icon={isAuthenticated ? faUserGear : faRightToBracket}
        className="h-4 text-gold2"
      />
      <span className="hidden max-w-[9rem] truncate sm:inline">{label}</span>
    </button>
  )
}
