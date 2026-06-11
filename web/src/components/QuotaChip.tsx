import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faBan, faXmark } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { toast } from '~/components/Toaster'
import { Spinner } from '~/components/Skeletons'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { championDisplayName, displaySkinName } from '~/lib/skinName'
import type { Skin } from '~/lib/types'

// Navbar quota chip ("★ 1/3 · ⊘ 2/3") that opens a "My picks" tray listing
// the skins the user has starred/banned, with one-click removal.
export default function QuotaChip() {
  const { isAuthenticated, isLoading, withApiToken } = useAuth()
  const stats = useSyncExternalStore(
    userStatsStore.subscribe,
    userStatsStore.get,
    userStatsStore.get,
  )
  // Server snapshot is false (no localStorage during SSR) — React reconciles
  // the client value after hydration without a mismatch.
  const hasQuotaHint = useSyncExternalStore(
    userStatsStore.subscribe,
    userStatsStore.hasPersisted,
    () => false,
  )

  const [open, setOpen] = useState(false)
  const [picks, setPicks] = useState<Skin[]>([])
  const [loadingPicks, setLoadingPicks] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Authoritative quota refresh — on auth change and after every vote
  // (skin cards dispatch 'updateUserStats').
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      userStatsStore.clear()
      return
    }
    let cancelled = false
    const refresh = async () => {
      try {
        const data = await withApiToken((token) => api.userStats(token))
        if (!cancelled)
          userStatsStore.set({
            usedStars: data.usedStars || 0,
            usedX: data.usedX || 0,
          })
      } catch {
        /* keep last known stats */
      }
    }
    refresh()
    window.addEventListener('updateUserStats', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('updateUserStats', refresh)
    }
  }, [isAuthenticated, isLoading, withApiToken])

  const loadPicks = useCallback(async () => {
    setLoadingPicks(true)
    try {
      const data = await withApiToken((token) => api.userVotes(token))
      setPicks((data.skins || []).filter((s) => s.user_star || s.user_x))
    } catch {
      /* tray shows empty state on failure */
    } finally {
      setLoadingPicks(false)
    }
  }, [withApiToken])

  useEffect(() => {
    if (open) loadPicks()
  }, [open, loadPicks])

  // Close on click outside / Escape.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const removePick = async (skin: Skin, kind: 'star' | 'x') => {
    try {
      await withApiToken((token) =>
        api.vote(
          {
            skinId: skin.id,
            vote: (skin.user_vote ?? 0) as -1 | 0 | 1,
            star: kind === 'star' ? false : !!skin.user_star,
            x: kind === 'x' ? false : !!skin.user_x,
          },
          token,
        ),
      )
      setPicks((prev) =>
        prev
          .map((p) =>
            p.id === skin.id
              ? {
                  ...p,
                  user_star: kind === 'star' ? false : p.user_star,
                  user_x: kind === 'x' ? false : p.user_x,
                }
              : p,
          )
          .filter((p) => p.user_star || p.user_x),
      )
      userStatsStore.adjust(kind === 'star' ? { stars: -1 } : { x: -1 })
      const s = userStatsStore.get()
      toast(
        kind === 'star'
          ? `Star removed — ${s.usedStars}/${MAX_STARS} used`
          : `Ban removed — ${s.usedX}/${MAX_X} used`,
        'success',
      )
      window.dispatchEvent(new CustomEvent('updateUserStats'))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove', 'error')
    }
  }

  // While the SDK restores the session, hold space with a placeholder when
  // the user was signed in here before (persisted quota doubles as the hint)
  // so the navbar doesn't shift when the chip appears.
  if (isLoading) {
    return hasQuotaHint ? (
      <div
        aria-hidden
        className="h-10 w-28 animate-pulse bg-hextech-black/40 outline outline-icon/30 -outline-offset-1"
      />
    ) : null
  }

  if (!isAuthenticated) return null

  const starred = picks.filter((p) => p.user_star)
  const banned = picks.filter((p) => p.user_x)

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`My picks: ${stats.usedStars} of ${MAX_STARS} stars used, ${stats.usedX} of ${MAX_X} bans used`}
        aria-expanded={open}
        title="My starred & banned skins"
        className={`flex h-10 cursor-pointer items-center gap-2 px-3 text-sm font-bold tabular-nums outline -outline-offset-1 transition duration-150 ${
          open
            ? 'bg-gold5/30 text-gold1 outline-gold2'
            : 'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <FontAwesomeIcon icon={faStar} className="h-3.5 text-gold2" />
          {stats.usedStars}/{MAX_STARS}
        </span>
        <span aria-hidden className="text-icon/50">
          ·
        </span>
        <span className="flex items-center gap-1.5">
          <FontAwesomeIcon icon={faBan} className="h-3.5" />
          {stats.usedX}/{MAX_X}
        </span>
      </button>

      {open && (
        <div className="animate-pop origin-top-right absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-hextech-black/95 shadow-2xl outline outline-gold2/30 -outline-offset-1 backdrop-blur">
          <div className="border-b border-icon/20 px-4 py-3">
            <p className="font-serif text-sm font-bold text-gold1">My Picks</p>
            <p className="text-xs text-grey1">
              Your {MAX_STARS} stars and {MAX_X} bans — remove one to free a
              slot.
            </p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loadingPicks ? (
              <p
                role="status"
                className="flex items-center justify-center gap-2.5 px-4 py-6 text-sm text-grey1"
              >
                <Spinner className="h-4 w-4" />
                Loading your picks…
              </p>
            ) : starred.length === 0 && banned.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-grey1">
                No stars or bans yet. Star the skins you love and ban the ones
                that miss.
              </p>
            ) : (
              <>
                <PickGroup
                  label={`Starred (${starred.length}/${MAX_STARS})`}
                  skins={starred}
                  kind="star"
                  onRemove={removePick}
                />
                <PickGroup
                  label={`Banned (${banned.length}/${MAX_X})`}
                  skins={banned}
                  kind="x"
                  onRemove={removePick}
                />
              </>
            )}
          </div>

          <div className="border-t border-icon/20 px-4 py-2.5">
            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="text-xs font-bold text-grey1 hover:text-gold1 transition duration-150"
            >
              View all my votes →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function PickGroup({
  label,
  skins,
  kind,
  onRemove,
}: {
  label: string
  skins: Skin[]
  kind: 'star' | 'x'
  onRemove: (skin: Skin, kind: 'star' | 'x') => void
}) {
  if (skins.length === 0) return null
  return (
    <div className="px-2 py-2">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-widest text-gold2/80">
        {label}
      </p>
      {skins.map((skin) => {
        const name = displaySkinName(skin.name, skin.champion_id)
        return (
          <div
            key={`${kind}-${skin.id}`}
            className="flex items-center gap-3 px-2 py-1.5 hover:bg-grey-cool/60"
          >
            <Link
              to="/champions/$id"
              params={{ id: skin.champion_id.toLowerCase() }}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <img
                src={skin.splash_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-9 w-16 shrink-0 object-cover outline outline-icon/20"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm text-gold1">
                  {name}
                </span>
                <span className="block truncate text-xs text-grey1">
                  {championDisplayName(skin.champion_id)}
                </span>
              </span>
            </Link>
            <button
              onClick={() => onRemove(skin, kind)}
              aria-label={`${kind === 'star' ? 'Unstar' : 'Unban'} ${name}`}
              title={kind === 'star' ? 'Remove star' : 'Remove ban'}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-grey1 outline outline-transparent hover:text-red-300 hover:outline-red-400/50 transition duration-150"
            >
              <FontAwesomeIcon icon={faXmark} className="h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
