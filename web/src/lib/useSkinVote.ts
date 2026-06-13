// The star/ban vote logic, lifted out of SkinCard so any surface can cast a
// vote with the same optimistic-update-and-rollback behaviour. SkinCard uses
// it for the catalog/wardrobe grids; the skin dossier uses it for its inline
// "cast your verdict" bar.
//
// Display rule (see CONTRACT.md): stars/bans are the SUPERLATIVE currency, a
// budget of MAX_STARS / MAX_X each - never a competing rank. Elo is the rank.

import { useEffect, useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { toast } from '~/components/Toaster'
import { userStatsStore, MAX_STARS, MAX_X } from '~/lib/userStatsStore'
import { captureSkinVote } from '~/lib/analytics'
import { openLoginPrompt } from '~/components/LoginPrompt'
import type { VoteTotals } from '~/lib/types'

export interface UseSkinVoteArgs {
  skinId: string
  championId: string
  // Display name, for toasts and analytics.
  skinName: string
  // Community totals to seed the counters before any vote.
  baseStars: number
  baseBans: number
  // The viewer's own current vote, layered in once authenticated.
  initialStar?: boolean
  initialX?: boolean
  // Where the vote came from, for the analytics funnel.
  source: 'skin_card' | 'skin_page'
}

export function useSkinVote({
  skinId,
  championId,
  skinName,
  baseStars,
  baseBans,
  initialStar,
  initialX,
  source,
}: UseSkinVoteArgs) {
  const { isAuthenticated, withApiToken } = useAuth()
  const posthog = usePostHog()

  const [totals, setTotals] = useState<VoteTotals>({
    total_stars: baseStars || 0,
    total_x: baseBans || 0,
  })
  const [userStar, setUserStar] = useState<boolean>(initialStar ?? false)
  const [userX, setUserX] = useState<boolean>(initialX ?? false)
  const [pending, setPending] = useState(false)

  // The viewer's own votes arrive after auth resolves (and after the dossier's
  // client-side enrichment); sync them in when they do.
  useEffect(() => {
    setUserStar(initialStar ?? false)
    setUserX(initialX ?? false)
  }, [initialStar, initialX])

  // Optimistic vote with rollback: state (and totals) update immediately, and
  // revert to the pre-vote snapshot if the API call fails.
  const castVote = async (
    next: { star: boolean; x: boolean },
    onSuccess?: () => void,
  ) => {
    const prev = { star: userStar, x: userX, totals }
    setUserStar(next.star)
    setUserX(next.x)
    setTotals({
      total_stars:
        prev.totals.total_stars + (next.star ? 1 : 0) - (prev.star ? 1 : 0),
      total_x: prev.totals.total_x + (next.x ? 1 : 0) - (prev.x ? 1 : 0),
    })
    setPending(true)
    try {
      const data = await withApiToken(
        (token) => api.vote({ skinId, star: next.star, x: next.x }, token),
        'Please sign in to vote.',
      )
      if (data.totals) setTotals(data.totals)
      onSuccess?.()
      window.dispatchEvent(new CustomEvent('updateUserStats'))
    } catch (err) {
      setUserStar(prev.star)
      setUserX(prev.x)
      setTotals(prev.totals)
      toast(err instanceof Error ? err.message : 'Vote failed', 'error')
    } finally {
      setPending(false)
    }
  }

  const handleStar = () => {
    if (!isAuthenticated) {
      promptLogin()
      return
    }
    const newStar = !userStar
    if (newStar && userStatsStore.get().usedStars >= MAX_STARS) {
      toast(`All ${MAX_STARS} stars used. Unstar another skin first.`, 'error')
      return
    }
    castVote({ star: newStar, x: userX }, () => {
      userStatsStore.adjust({ stars: newStar ? 1 : -1 })
      const used = userStatsStore.get().usedStars
      captureSkinVote(posthog, newStar ? 'star' : 'unstar', {
        skinId,
        skinName,
        championId,
        used,
        source,
      })
      toast(
        newStar
          ? `Star ${used}/${MAX_STARS} used`
          : `Star removed. ${used}/${MAX_STARS} used`,
        'success',
      )
    })
  }

  const handleX = () => {
    if (!isAuthenticated) {
      promptLogin()
      return
    }
    const newX = !userX
    if (newX && userStatsStore.get().usedX >= MAX_X) {
      toast(`All ${MAX_X} bans used. Unban another skin first.`, 'error')
      return
    }
    castVote({ star: userStar, x: newX }, () => {
      userStatsStore.adjust({ x: newX ? 1 : -1 })
      const used = userStatsStore.get().usedX
      captureSkinVote(posthog, newX ? 'ban' : 'unban', {
        skinId,
        skinName,
        championId,
        used,
        source,
      })
      toast(
        newX ? `Ban ${used}/${MAX_X} used` : `Ban removed. ${used}/${MAX_X} used`,
        'success',
      )
    })
  }

  // Sign-in intent from a star/ban gate - the activation funnel's missing
  // first step, captured before the redirect.
  const promptLogin = () => {
    posthog.capture('auth_prompt_clicked', {
      trigger: 'star_ban_gate',
      source,
      skin_id: skinId,
    })
    openLoginPrompt()
  }

  return {
    totals,
    userStar,
    userX,
    pending,
    isAuthenticated,
    handleStar,
    handleX,
    promptLogin,
  }
}
