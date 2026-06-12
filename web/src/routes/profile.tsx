import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUp,
  faArrowDown,
  faStar,
  faBan,
  faCheckToSlot,
  faScaleUnbalanced,
  faUser,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import SkinCard from '~/components/SkinCard'
import EmptyState from '~/components/EmptyState'
import ErrorState from '~/components/ErrorState'
import LogoutButton from '~/components/LogoutButton'
import DeleteAccountButton from '~/components/DeleteAccountButton'
import MirrorView from '~/components/MirrorView'
import { Spinner } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { btnPrimarySm } from '~/lib/ui'
import { fetchMirror } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'
import type { Me, Skin } from '~/lib/types'

// Per-user quota, mirrored from CONTRACT.md (max 3 stars / 3 bans).
const MAX_STARS = 3
const MAX_X = 3

type Tab = 'mirror' | 'votes' | 'account'

// The profile IS the Mirror (ROUTES.md): the tier list your battles build is
// the page's centerpiece, with the voting record and account settings as
// quiet tabs. Guest-capable — guests battle, so guests have a mirror — which
// makes this page itself the sign-up pitch.
export const Route = createFileRoute('/profile')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    s.tab === 'votes' || s.tab === 'account' ? { tab: s.tab } : {},
  // The Mirror loads before render (SSR-complete, read-only — viewing mints
  // nothing). Votes/account are auth-only and load client-side per tab.
  loader: () => fetchMirror({ data: { restoreToken: guestRestoreToken() } }),
  head: () => ({
    meta: [
      { title: 'Your Mirror — Skin Battle' },
      {
        name: 'description',
        content:
          'Your personal League skin tier list, auto-built from your battles — plus your votes and account.',
      },
      ...ogMeta({
        title: 'The Mirror — Skin Battle',
        description:
          'The personal tier list your battles build — plus your most contrarian takes.',
        card: 'mirror',
        path: '/profile',
      }),
    ],
  }),
  errorComponent: ({ error }) => (
    <ErrorState title="Couldn't load your Mirror" message={error.message} />
  ),
  component: ProfilePage,
})

// ─── shared tab bits ────────────────────────────────────────────────────────

const tabClass = (active: boolean) =>
  `flex h-11 items-center gap-2.5 px-5 font-serif font-bold transition duration-150 outline -outline-offset-2 ${
    active
      ? 'bg-gold5/25 text-gold1 outline-gold2/60'
      : 'bg-hextech-black/40 text-grey1 outline-icon/30 hover:text-gold1 hover:outline-icon'
  }`

// Inline sign-in gate for the auth-only tabs — the page itself stays open to
// guests (the Mirror works without an account).
function SignInGate({ message }: { message: string }) {
  const { login } = useAuth()
  return (
    <div className="animate-fade-up flex max-w-xl flex-col items-start gap-5 bg-hextech-black/30 p-8 outline outline-icon/20 -outline-offset-2">
      <p className="text-grey1">{message}</p>
      <button onClick={login} className={btnPrimarySm}>
        Sign In
      </button>
    </div>
  )
}

function TabLoading() {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-grey1">
      <Spinner className="h-4 w-4" />
      Loading…
    </div>
  )
}

// ─── votes tab ──────────────────────────────────────────────────────────────

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

function VotesTab() {
  const { isAuthenticated, isLoading, withApiToken } = useAuth()
  const [skins, setSkins] = useState<Skin[]>([])
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
        const votes = await withApiToken((token) => api.userVotes(token))
        if (!cancelled) setSkins(votes.skins || [])
      } catch (err) {
        if (!cancelled)
          setErrorMsg(
            err instanceof Error ? err.message : 'Failed to load your votes',
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

  if (isLoading || (isAuthenticated && loading)) return <TabLoading />
  if (!isAuthenticated)
    return (
      <SignInGate message="Stars, bans, and up/down votes belong to your account — sign in to see your voting record." />
    )
  if (errorMsg)
    return <ErrorState title="Couldn't load your votes" message={errorMsg} />

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
    <>
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
        <StatTile icon={faArrowUp} value={`${upvoted.length}`} label="Upvoted" />
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
    </>
  )
}

// ─── account tab ────────────────────────────────────────────────────────────

function AccountTab() {
  const { isAuthenticated, isLoading, withApiToken } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (isLoading) return
      try {
        setLoading(true)
        if (!isAuthenticated) return
        const meData = await withApiToken((token) => api.me(token))
        if (!cancelled) setMe(meData)
      } catch {
        /* the settings card just shows less */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, withApiToken])

  if (isLoading || (isAuthenticated && loading)) return <TabLoading />
  if (!isAuthenticated)
    return (
      <SignInGate message="Sign in to manage your account — and to attach your guest battles and streaks to a name that holds leaderboard spots." />
    )

  return (
    <div className="animate-fade-up w-full max-w-md bg-hextech-black/30 outline outline-icon/20 -outline-offset-2 p-8">
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
  )
}

// ─── page ───────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: IconDefinition }[] = [
  { id: 'mirror', label: 'The Mirror', icon: faScaleUnbalanced },
  { id: 'votes', label: 'My Votes', icon: faCheckToSlot },
  { id: 'account', label: 'Account', icon: faUser },
]

function ProfilePage() {
  const mirror = Route.useLoaderData()
  const { tab } = Route.useSearch()
  const active: Tab = tab ?? 'mirror'

  // Mirror the guest token to localStorage as a cookie backup.
  useEffect(() => {
    rememberGuestToken(mirror.guestToken)
  }, [mirror.guestToken])

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          Your taste, reflected
        </p>
        <h1 className="font-serif text-4xl font-bold text-gold1 md:text-5xl">
          The M<span className="italic">irror</span>
        </h1>
      </header>

      <div
        role="group"
        aria-label="Profile sections"
        className="mb-10 flex flex-wrap items-center gap-2"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/profile"
            search={t.id === 'mirror' ? {} : { tab: t.id }}
            aria-current={active === t.id ? 'page' : undefined}
            className={tabClass(active === t.id)}
          >
            <FontAwesomeIcon icon={t.icon} className="h-4" />
            {t.label}
          </Link>
        ))}
      </div>

      {active === 'mirror' && <MirrorView state={mirror} />}
      {active === 'votes' && <VotesTab />}
      {active === 'account' && <AccountTab />}
    </div>
  )
}
