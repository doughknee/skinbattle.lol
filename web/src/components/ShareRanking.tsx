import { useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faShareNodes } from '@fortawesome/free-solid-svg-icons'
import { toast } from '~/components/Toaster'
import { btnSecondarySm } from '~/lib/ui'
import {
  rankingShareText,
  shareUrl,
  type PageType,
  type RankingState,
} from '~/lib/games/settle'

// One share control for every ranking surface. The payload is the live top
// three the page just rendered plus the verdict's own state, so a share can
// never name a winner the page does not show or call a provisional ranking
// settled. The link is the canonical page carrying share attribution
// (settle.ts shareUrl) - never a session URL.
//
// Web Share where the platform has a sheet, the clipboard everywhere else.
// Decided at click time, not render time: the button is server-rendered and
// `navigator` only exists on the client, so a render-time branch would
// hydrate differently from what the server painted.
export default function ShareRanking({
  title,
  top,
  state,
  path,
  pageType,
  champion,
}: {
  title: string // "Ahri", "975 RP skins"
  top: string[] // rows as shown, best first
  state: RankingState
  path: string // canonical path, e.g. /champions/ahri
  pageType: PageType
  champion: string | null // lowercase id, for the event
}) {
  const posthog = usePostHog()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const share = async () => {
    if (busy) return
    setBusy(true)
    const native = typeof navigator.share === 'function'
    const medium = native ? 'native' : 'copy'
    const url = shareUrl(window.location.origin, path, medium)
    try {
      if (native) {
        // The sheet carries the link in its own field; the text stops short of
        // it so targets that merge the two never print the URL twice.
        await navigator.share({
          title: `${title} · SkinBattle community ranking`,
          text: rankingShareText({ title, top, state }),
          url,
        })
      } else {
        await navigator.clipboard.writeText(
          rankingShareText({ title, top, state, url }),
        )
        toast('Ranking copied. Go settle the argument.', 'success')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
      posthog?.capture('ranking_shared', {
        method: medium,
        page_type: pageType,
        champion,
        ranking_state: state,
      })
    } catch (err) {
      // A dismissed sheet is not a share and not an error.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        toast("Couldn't share. Copy the address bar instead.", 'error')
      }
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
