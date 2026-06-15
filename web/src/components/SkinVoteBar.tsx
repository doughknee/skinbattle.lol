import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faBan } from '@fortawesome/free-solid-svg-icons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { useSkinVote } from '~/lib/useSkinVote'
import { MAX_STARS, MAX_X } from '~/lib/userStatsStore'

// The skin dossier's "cast your verdict" control. The old All Skins grid was
// where people spent their stars and bans; with it gone, the per-skin page is
// the home for casting (alongside the champion wardrobe). Same vote logic as
// the catalog cards, sized up for a single skin.

interface SkinVoteBarProps {
  skinId: string
  championId: string
  skinName: string
  baseStars: number
  baseBans: number
}

const chip =
  'flex h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 font-serif text-base font-bold outline -outline-offset-1 transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const chipIdle =
  'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
const chipStarOn = 'bg-gold5/30 text-gold1 outline-gold2'
const chipBanOn = 'bg-danger-surface/50 text-danger outline-danger-border/70'

export default function SkinVoteBar({
  skinId,
  championId,
  skinName,
  baseStars,
  baseBans,
}: SkinVoteBarProps) {
  const { isAuthenticated, getApiToken } = useAuth()
  const [mine, setMine] = useState<{ star: boolean; x: boolean }>({
    star: false,
    x: false,
  })

  // The viewer's own star/ban isn't in the public dossier load, so layer it in
  // client-side once we hold a token - the same trick the champion wardrobe
  // uses. A whole-champion read is the lightest call that carries user columns.
  useEffect(() => {
    let cancelled = false
    async function enrich() {
      if (!isAuthenticated) {
        setMine({ star: false, x: false })
        return
      }
      const token = await getApiToken()
      if (!token) return
      try {
        const champ = await api.champion(championId, token)
        const s = champ.skins.find((sk) => sk.id === skinId)
        if (s && !cancelled) {
          setMine({ star: s.user_star ?? false, x: s.user_x ?? false })
        }
      } catch {
        /* keep defaults - the bar still works, it just doesn't preselect */
      }
    }
    enrich()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getApiToken, championId, skinId])

  const { totals, userStar, userX, pending, handleStar, handleX } = useSkinVote({
    skinId,
    championId,
    skinName,
    baseStars,
    baseBans,
    initialStar: mine.star,
    initialX: mine.x,
    source: 'skin_page',
  })

  return (
    <section className="animate-fade-up mt-6 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gold2">
          <FontAwesomeIcon icon={faStar} className="h-3.5" />
          Cast your verdict
        </p>
        <p className="text-sm text-grey1">
          {MAX_STARS} stars, {MAX_X} bans. Spend them on the skins that earn it.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleStar}
          disabled={pending}
          aria-pressed={userStar}
          aria-label={
            userStar ? `Unstar ${skinName}` : `Star ${skinName} (${MAX_STARS} max)`
          }
          title={
            userStar ? 'Remove star' : `Star this skin. You only get ${MAX_STARS}`
          }
          className={`${chip} ${userStar ? chipStarOn : chipIdle}`}
        >
          <FontAwesomeIcon icon={faStar} className="h-4" />
          <span className="tabular-nums">{totals.total_stars}</span>
          <span>{userStar ? 'Starred' : 'Star'}</span>
        </button>
        <button
          onClick={handleX}
          disabled={pending}
          aria-pressed={userX}
          aria-label={userX ? `Unban ${skinName}` : `Ban ${skinName} (${MAX_X} max)`}
          title={userX ? 'Remove ban' : `Ban this skin. You only get ${MAX_X}`}
          className={`${chip} ${userX ? chipBanOn : chipIdle}`}
        >
          <FontAwesomeIcon icon={faBan} className="h-4" />
          <span className="tabular-nums">{totals.total_x}</span>
          <span>{userX ? 'Banned' : 'Ban'}</span>
        </button>
      </div>
    </section>
  )
}
