import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightToBracket, faUserGear } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { championIconUrl, useDDragonVersion } from '~/lib/ddragon'
import {
  PROFILE_UPDATED_EVENT,
  clearCachedProfile,
  readCachedProfile,
  writeCachedProfile,
  type CachedProfile,
} from '~/lib/profileCache'

export default function AccountButton() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, withApiToken, login } = useAuth()
  // Cached profile (localStorage) shows the name/avatar immediately instead
  // of waiting on /me every load; /me reconciles it in the background.
  const [profile, setProfile] = useState<CachedProfile>(() =>
    readCachedProfile(),
  )
  const ddVersion = useDDragonVersion()

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      clearCachedProfile()
      setProfile({ username: null, avatarChampionId: null })
      return
    }
    // Reconcile against /me (covers renames, avatar changes, and a different
    // account signing in on this browser).
    let cancelled = false
    ;(async () => {
      try {
        const me = await withApiToken((token) => api.me(token))
        if (!me?.username) return
        const fresh: CachedProfile = {
          username: me.username,
          avatarChampionId: me.avatar_champion_id ?? null,
        }
        writeCachedProfile(fresh)
        if (!cancelled) setProfile(fresh)
      } catch {
        /* fall back to the cached or generic "Account" label */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, withApiToken])

  // Live updates from the Account tab (rename / avatar change) in-session.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      setProfile((e as CustomEvent).detail as CachedProfile)
    }
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate)
  }, [])

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

  const label = isAuthenticated ? (profile.username ?? 'Account') : 'Sign in'
  const avatarUrl =
    isAuthenticated && profile.avatarChampionId && ddVersion
      ? championIconUrl(profile.avatarChampionId, ddVersion)
      : null

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
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="h-6 w-6 outline outline-gold5/60 -outline-offset-1"
        />
      ) : (
        <FontAwesomeIcon
          icon={isAuthenticated ? faUserGear : faRightToBracket}
          className="h-4 text-gold2"
        />
      )}
      <span className="hidden max-w-[9rem] truncate sm:inline">{label}</span>
    </button>
  )
}
