import { useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faShareNodes } from '@fortawesome/free-solid-svg-icons'
import { toast } from '~/components/Toaster'
import { btnSecondarySm } from '~/lib/ui'
import {
  rankingShareText,
  shareOrCopy,
  type PageType,
  type RankingState,
} from '~/lib/games/settle'

// One share control for every ranking surface. The payload is the live top
// three the page just rendered plus the verdict's own state, so a share can
// never name a winner the page does not show or call a provisional ranking
// settled. The link is the canonical page carrying share attribution
// (settle.ts shareOrCopy) - never a session URL.
export default function ShareRanking({
  title,
  champion,
  top,
  state,
  battles,
  path,
  pageType,
  championSlug,
}: {
  title: string // "Ahri", "975 RP skins"
  champion: boolean // a champion's wardrobe, or a cross-champion slice
  top: string[] // rows as shown, best first
  state: RankingState
  battles: number // the leader's battle count
  path: string // canonical path, e.g. /champions/ahri
  pageType: PageType
  championSlug: string | null // lowercase id, for the event
}) {
  const posthog = usePostHog()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const share = async () => {
    if (busy) return
    setBusy(true)
    try {
      const medium = await shareOrCopy({
        title: champion ? `${title}'s best skin · SkinBattle` : `${title} · SkinBattle`,
        text: rankingShareText({ title, champion, top, state, battles }),
        path,
      })
      if (!medium) return // the sheet was dismissed
      if (medium === 'copy') {
        toast('Ranking copied. Go settle the argument.', 'success')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
      posthog?.capture('ranking_shared', {
        method: medium,
        page_type: pageType,
        champion: championSlug,
        ranking_state: state,
      })
    } catch {
      toast("Couldn't share. Copy the address bar instead.", 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      aria-label={`Share the ${title} ranking`}
      className={btnSecondarySm}
    >
      <FontAwesomeIcon icon={copied ? faCheck : faShareNodes} className="h-4" />
      {copied ? 'Copied' : 'Share ranking'}
    </button>
  )
}
