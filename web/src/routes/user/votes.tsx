import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import SkinCard from '~/components/SkinCard'
import AuthPrompt from '~/components/AuthPrompt'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import type { Skin } from '~/lib/types'

export const Route = createFileRoute('/user/votes')({
  component: UserVotesPage,
})

function VoteSection({
  title,
  emptyText,
  skins,
}: {
  title: string
  emptyText: string
  skins: Skin[]
}) {
  return (
    <section className="mb-24">
      <h2 className="text-3xl font-serif font-semibold mb-2 text-gold2">
        {title}
        <span className="ml-3 text-lg font-normal text-grey1">
          {skins.length}
        </span>
      </h2>
      {skins.length === 0 ? (
        <p className="text-lg text-grey1">{emptyText}</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {skins.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              championId={skin.champion_id}
              initialVote={skin.user_vote}
              initialStar={skin.user_star}
              initialX={skin.user_x}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function UserVotesPage() {
  const { isAuthenticated, isLoading, getApiToken } = useAuth()

  const [skins, setSkins] = useState<Skin[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchVotes() {
      if (isLoading) return
      try {
        setLoading(true)
        setErrorMsg(null)
        if (!isAuthenticated) {
          if (!cancelled) setSkins([])
          return
        }
        const token = await getApiToken()
        if (!token) {
          if (!cancelled) setSkins([])
          return
        }
        const data = await api.userVotes(token)
        if (!cancelled) setSkins(data.skins || [])
      } catch (err) {
        if (!cancelled)
          setErrorMsg(
            err instanceof Error ? err.message : 'Failed to fetch user votes',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchVotes()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, getApiToken])

  if (isLoading || loading)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed">
        <p className="text-3xl font-serif font-bold text-gold2">
          Blaming the jungler...
        </p>
      </div>
    )

  if (!isAuthenticated)
    return (
      <AuthPrompt
        title="Your Votes"
        message="Sign in to see every skin you've upvoted, starred, and banned."
      />
    )

  if (errorMsg)
    return (
      <p className="container mx-auto px-6 pt-44 text-center text-red-400">
        {errorMsg}
      </p>
    )

  const upvoted = skins.filter((skin) => skin.user_vote === 1)
  const downvoted = skins.filter((skin) => skin.user_vote === -1)
  const starred = skins.filter((skin) => skin.user_star)
  const xed = skins.filter((skin) => skin.user_x)

  return (
    <div className="container mx-auto p-4 pt-36">
      <header className="mb-16 max-w-3xl">
        <h1 className="text-5xl md:text-6xl font-bold font-serif mb-3 text-gold2">
          Your Votes
        </h1>
        <p className="text-xl text-grey1">
          Your votes are <span className="italic">godlike</span> — every upvote,
          downvote, star, and ban shapes the rankings. Here's everything you've
          weighed in on.
        </p>
      </header>

      <VoteSection
        title="Starred Skins"
        emptyText="No starred skins yet — spend your 3 stars on the skins you love most."
        skins={starred}
      />
      <VoteSection
        title="Banned Skins"
        emptyText="No banned skins yet — use your 3 bans on the ones that missed."
        skins={xed}
      />
      <VoteSection
        title="Upvoted Skins"
        emptyText="No upvoted skins yet."
        skins={upvoted}
      />
      <VoteSection
        title="Downvoted Skins"
        emptyText="No downvoted skins yet."
        skins={downvoted}
      />
    </div>
  )
}
