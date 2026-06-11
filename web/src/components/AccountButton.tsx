import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightToBracket, faUserGear } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'

// Cache the username across mounts AND hard reloads (localStorage), so the
// header shows the name immediately instead of waiting on /me every load.
const USERNAME_KEY = 'sb:username'

function readCachedUsername(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(USERNAME_KEY)
  } catch {
    return null
  }
}

let cachedUsername: string | null = readCachedUsername()

function writeCachedUsername(value: string | null) {
  cachedUsername = value
  if (typeof window === 'undefined') return
  try {
    if (value === null) localStorage.removeItem(USERNAME_KEY)
    else localStorage.setItem(USERNAME_KEY, value)
  } catch {
    /* storage unavailable — in-memory cache still works */
  }
}

export default function AccountButton() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, withApiToken, login } = useAuth()
  const [username, setUsername] = useState<string | null>(cachedUsername)

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      writeCachedUsername(null)
      setUsername(null)
      return
    }
    // Show the cached name instantly, but still reconcile against /me in the
    // background (covers renames and a different account signing in).
    if (cachedUsername) setUsername(cachedUsername)
    let cancelled = false
    ;(async () => {
      try {
        const me = await withApiToken((token) => api.me(token))
        if (me?.username && me.username !== cachedUsername) {
          writeCachedUsername(me.username)
          if (!cancelled) setUsername(me.username)
        }
      } catch {
        /* fall back to the cached or generic "Account" label */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, withApiToken])

  // While the SDK restores the session from storage (and during SSR), the
  // auth state is unknown — render a placeholder instead of flashing
  // "Sign in" at a signed-in user on every page load.
  if (isLoading) {
    return (
      <div
        aria-hidden
        className="h-10 w-10 animate-pulse bg-hextech-black/40 outline outline-icon/30 -outline-offset-1 sm:w-28"
      />
    )
  }

  const label = isAuthenticated ? (username ?? 'Account') : 'Sign in'

  return (
    <button
      onClick={() => {
        if (isAuthenticated) {
          navigate({ to: '/profile' })
        } else {
          login()
        }
      }}
      type="button"
      aria-label={isAuthenticated ? `Profile: ${label}` : 'Sign in'}
      title={isAuthenticated ? 'Your profile' : 'Sign in'}
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
