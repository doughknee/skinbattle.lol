import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  faArrowUp,
  faArrowDown,
  faStar,
  faBan,
  faCheckToSlot,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import SkinCard from '~/components/SkinCard'
import AuthPrompt from '~/components/AuthPrompt'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import type { Skin } from '~/lib/types'

export const Route = createFileRoute('/user/votes')({
  head: () => ({
    meta: [{ title: 'My Votes — Skin Battle' }],
  }),
  component: UserVotesPage,
})

function VoteSection({
  title,
  icon,
  emptyTitle,
  emptyText,
  skins,
}: {
  title: string
  icon: IconDefinition
  emptyTitle: string
  emptyText: string
  skins: Skin[]
}) {
  return (
    <section className="mb-24">
      <h2 className="font-serif text-3xl md:text-4xl font-bold mb-2 text-gold2">
        {title}
        <span className="ml-3 text-lg font-normal text-grey1">
          {skins.length}
        </span>
      </h2>
      {skins.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={icon}
            title={emptyTitle}
            message={emptyText}
            compact
          />
        </div>
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
              showChampion
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
    return <RouteSkeleton quip="Blaming the jungler..." />

  if (!isAuthenticated)
    return (
      <AuthPrompt
        title="Your Votes"
        message="Sign in to see every skin you've upvoted, starred, and banned."
      />
    )

  if (errorMsg)
    return <ErrorState title="Couldn't load your votes" message={errorMsg} />

  const upvoted = skins.filter((skin) => skin.user_vote === 1)
  const downvoted = skins.filter((skin) => skin.user_vote === -1)
  const starred = skins.filter((skin) => skin.user_star)
  const xed = skins.filter((skin) => skin.user_x)

  return (
    <div className="container mx-auto px-6 pt-28 pb-12">
      <PageHeader
        eyebrow="Your voting record"
        title="Your Votes"
        subtitle={
          <>
            Your votes are <span className="italic">godlike</span> — every
            upvote, downvote, star, and ban shapes the rankings. Here's
            everything you've weighed in on.
          </>
        }
        className="mb-16"
      />

      {skins.length === 0 ? (
        <EmptyState
          icon={faCheckToSlot}
          title="You haven't voted yet"
          message="Browse the champions, pick your favorites, and your record will show up here."
          cta={{ to: '/champions', label: 'Start Voting' }}
        />
      ) : (
        <>
          <VoteSection
            title="Starred Skins"
            icon={faStar}
            emptyTitle="No stars spent"
            emptyText="Spend your 3 stars on the skins you love most."
            skins={starred}
          />
          <VoteSection
            title="Banned Skins"
            icon={faBan}
            emptyTitle="No bans cast"
            emptyText="Use your 3 bans on the ones that missed."
            skins={xed}
          />
          <VoteSection
            title="Upvoted Skins"
            icon={faArrowUp}
            emptyTitle="No upvotes yet"
            emptyText="Push the skins you like up the rankings."
            skins={upvoted}
          />
          <VoteSection
            title="Downvoted Skins"
            icon={faArrowDown}
            emptyTitle="No downvotes yet"
            emptyText="Send the misses to the bottom."
            skins={downvoted}
          />
        </>
      )}
    </div>
  )
}
