import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
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
import LogoutButton from '~/components/LogoutButton'
import DeleteAccountButton from '~/components/DeleteAccountButton'
import PageHeader from '~/components/PageHeader'
import { RouteSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import type { Me, Skin } from '~/lib/types'

// Per-user quota, mirrored from CONTRACT.md (max 3 stars / 3 bans).
const MAX_STARS = 3
const MAX_X = 3

export const Route = createFileRoute('/profile')({
  head: () => ({
    meta: [{ title: 'Profile — Skin Battle' }],
  }),
  component: ProfilePage,
})

function StatTile({
  icon,
  value,
  label,
}: {
  icon: IconDefinition
  value: string
  label: string
}) {
  return (
    <div className="flex items-center gap-4 bg-hextech-black/30 p-5 outline outline-icon/20 -outline-offset-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
        <FontAwesomeIcon icon={icon} className="h-5 text-gold2" />
      </div>
      <div>
        <div className="font-serif text-2xl font-bold text-gold1 tabular-nums">
          {value}
        </div>
        <div className="text-xs uppercase tracking-widest text-grey1">
          {label}
        </div>
      </div>
    </div>
  )
}

function VoteSection({ title, skins }: { title: string; skins: Skin[] }) {
  return (
    <section className="animate-fade-up mb-20">
      <h2 className="font-serif text-3xl md:text-4xl font-bold mb-2 text-gold2">
        {title}
        <span className="ml-3 text-lg font-normal text-grey1">
          {skins.length}
        </span>
      </h2>
      <div className="stagger mt-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
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
    </section>
  )
}

function ProfilePage() {
  const { isAuthenticated, isLoading, withApiToken } = useAuth()

  const [skins, setSkins] = useState<Skin[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (isLoading) return
      try {
        setLoading(true)
        setErrorMsg(null)
        if (!isAuthenticated) return
        const [votes, meData] = await withApiToken((token) =>
          Promise.all([api.userVotes(token), api.me(token)]),
        )
        if (!cancelled) {
          setSkins(votes.skins || [])
          setMe(meData)
        }
      } catch (err) {
        if (!cancelled)
          setErrorMsg(
            err instanceof Error ? err.message : 'Failed to load your profile',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, withApiToken])

  if (isLoading || loading)
    return <RouteSkeleton quip="Blaming the jungler..." />

  if (!isAuthenticated)
    return (
      <AuthPrompt
        title="Your Profile"
        message="Sign in to see your voting record and manage your account."
      />
    )

  if (errorMsg)
    return <ErrorState title="Couldn't load your profile" message={errorMsg} />

  const upvoted = skins.filter((skin) => skin.user_vote === 1)
  const downvoted = skins.filter((skin) => skin.user_vote === -1)
  const starred = skins.filter((skin) => skin.user_star)
  const xed = skins.filter((skin) => skin.user_x)

  // Only sections with content render — the stat strip already accounts for
  // all four buckets, so empty grids would just repeat "0".
  const voteSections = [
    { title: 'Starred Skins', skins: starred },
    { title: 'Banned Skins', skins: xed },
    { title: 'Upvoted Skins', skins: upvoted },
    { title: 'Downvoted Skins', skins: downvoted },
  ].filter((s) => s.skins.length > 0)

  return (
    <div className="container mx-auto px-6 pt-28 pb-12">
      <PageHeader
        eyebrow="Summoner profile"
        title={me?.username || 'Profile'}
        subtitle="Your voting record and your account, all in one place."
        className="mb-12"
      />

      {/* Stat strip */}
      <div className="stagger mb-20 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={faStar}
          value={`${starred.length}/${MAX_STARS}`}
          label="Stars spent"
        />
        <StatTile
          icon={faBan}
          value={`${xed.length}/${MAX_X}`}
          label="Bans used"
        />
        <StatTile
          icon={faArrowUp}
          value={`${upvoted.length}`}
          label="Upvoted"
        />
        <StatTile
          icon={faArrowDown}
          value={`${downvoted.length}`}
          label="Downvoted"
        />
      </div>

      {voteSections.length === 0 ? (
        <div className="mb-20">
          <EmptyState
            icon={faCheckToSlot}
            title="You haven't voted yet"
            message="Browse the champions, pick your favorites, and your record will show up here."
            cta={{ to: '/champions', label: 'Start Voting' }}
          />
        </div>
      ) : (
        voteSections.map((s) => (
          <VoteSection key={s.title} title={s.title} skins={s.skins} />
        ))
      )}

      {/* Account settings */}
      <section className="animate-fade-up border-t border-icon/20 pt-12">
        <h2 className="font-serif text-3xl md:text-4xl font-bold mb-8 text-gold2">
          Account
        </h2>
        <div className="w-full max-w-md bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-8">
          {me?.username && (
            <div className="mb-5">
              <div className="text-xs uppercase tracking-widest text-grey1 mb-1">
                Username
              </div>
              <div className="text-lg text-gold1 font-serif">{me.username}</div>
            </div>
          )}
          <div className="mb-8">
            <div className="text-xs uppercase tracking-widest text-grey1 mb-1">
              Email
            </div>
            <div className="text-lg text-gold1 font-serif break-all">
              {me?.email}
            </div>
          </div>

          <LogoutButton />

          <div className="mt-8 border-t border-red-400/20 pt-6">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-red-300/80">
              Danger zone
            </p>
            <p className="mb-4 text-sm text-grey1">
              Deleting your account permanently removes your votes, stars, and
              bans.
            </p>
            <DeleteAccountButton />
          </div>
        </div>
      </section>
    </div>
  )
}
