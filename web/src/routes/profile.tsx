import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faScaleUnbalanced, faUser } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import ErrorState from '~/components/ErrorState'
import AccountSettings from '~/components/AccountSettings'
import MirrorView from '~/components/MirrorView'
import { AccountTabSkeleton } from '~/components/Skeletons'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { championIconUrl, useDDragonVersion } from '~/lib/ddragon'
import {
  PROFILE_UPDATED_EVENT,
  readCachedProfile,
  type CachedProfile,
} from '~/lib/profileCache'
import { btnPrimarySm } from '~/lib/ui'
import { fetchMirror } from '~/lib/games/serverFns'
import { guestRestoreToken, rememberGuestToken } from '~/lib/games/client'
import { ogMeta } from '~/lib/games/ogMeta'
import type { Me } from '~/lib/types'

type Tab = 'mirror' | 'account'

// The profile IS the Mirror (ROUTES.md): the tier list your battles build is
// the page's centerpiece, with the voting record and account settings as
// quiet tabs. Guest-capable - guests battle, so guests have a mirror - which
// makes this page itself the sign-up pitch.
export const Route = createFileRoute('/profile')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    s.tab === 'account' ? { tab: s.tab } : {},
  // The Mirror loads before render (SSR-complete, read-only - viewing mints
  // nothing). Votes/account are auth-only; the page prefetches both payloads
  // in the background once auth resolves, so tab switches are instant.
  loader: () => fetchMirror({ data: { restoreToken: guestRestoreToken() } }),
  head: () => ({
    meta: [
      { title: 'Your Mirror · Skin Battle' },
      {
        name: 'description',
        content:
          'Your personal League skin tier list, auto-built from your battles, plus your votes and account.',
      },
      ...ogMeta({
        title: 'The Mirror · Skin Battle',
        description:
          'The personal tier list your battles build, plus your most contrarian takes.',
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

// Inline sign-in gate for the auth-only tabs - the page itself stays open to
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

// ─── account tab ────────────────────────────────────────────────────────────

// Renders the prefetched account payload; `settled` flips once the background
// fetch finished (even on failure - the settings card just shows less).
function AccountTab({
  me,
  settled,
  onChange,
}: {
  me: Me | null
  settled: boolean
  onChange: (me: Me) => void
}) {
  const { isAuthenticated, isLoading } = useAuth()

  if (!isLoading && !isAuthenticated)
    return (
      <SignInGate message="Sign in to manage your account, and to attach your guest battles and streaks to a name that holds leaderboard spots." />
    )
  if (isLoading || !settled) return <AccountTabSkeleton />

  return <AccountSettings me={me} onChange={onChange} />
}

// ─── page ───────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: IconDefinition }[] = [
  { id: 'mirror', label: 'The Mirror', icon: faScaleUnbalanced },
  { id: 'account', label: 'Account', icon: faUser },
]

// The header belongs to the person, not to one tab: the title is the
// username (when known), and only the eyebrow follows the active tab.
const TAB_EYEBROWS: Record<Tab, string> = {
  mirror: 'Your taste, reflected',
  account: 'Your settings',
}

function ProfilePage() {
  const mirror = Route.useLoaderData()
  const { tab } = Route.useSearch()
  const active: Tab = tab ?? 'mirror'
  const { isAuthenticated, isLoading, withApiToken } = useAuth()
  const posthog = usePostHog()

  // Mirror the guest token to localStorage as a cookie backup.
  useEffect(() => {
    rememberGuestToken(mirror.guestToken)
  }, [mirror.guestToken])

  // The Mirror is the activation asset ("sign in to keep it"), so record a
  // view when it's the active tab - the funnel's proof of engagement before
  // the sign-in prompt. player_tier rides along as a super-property.
  useEffect(() => {
    if (active !== 'mirror') return
    posthog.capture('mirror_viewed', {
      skins_ranked: mirror.skinsRated,
      total_battles: mirror.totalBattles,
    })
  }, [active, posthog, mirror.skinsRated, mirror.totalBattles])

  // Header identity: the cached profile paints instantly (same trick as the
  // navbar's AccountButton), /me corrects it when it lands, and saves from
  // the Account tab update it live via the profile event.
  const [profile, setProfile] = useState<CachedProfile>({
    username: null,
    avatarChampionId: null,
  })
  const ddVersion = useDDragonVersion()
  useEffect(() => {
    setProfile(readCachedProfile())
    const onUpdate = (e: Event) =>
      setProfile((e as CustomEvent).detail as CachedProfile)
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate)
  }, [])

  // Prefetch the Account payload as soon as auth resolves, so switching to
  // Account renders cached data instead of refetching.
  const [me, setMe] = useState<Me | null>(null)
  const [meSettled, setMeSettled] = useState(false)

  useEffect(() => {
    if (isLoading || !isAuthenticated) return
    let cancelled = false
    withApiToken((token) => api.me(token))
      .then((meData) => {
        if (cancelled) return
        setMe(meData)
        setProfile({
          username: meData.username ?? null,
          avatarChampionId: meData.avatar_champion_id ?? null,
        })
      })
      .catch(() => {
        /* the settings card just shows less */
      })
      .finally(() => {
        if (!cancelled) setMeSettled(true)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, withApiToken])

  return (
    <div className="container mx-auto max-w-5xl px-6 pt-28 pb-16">
      <header className="animate-fade-up mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
          {TAB_EYEBROWS[active]}
        </p>
        <div className="flex items-center gap-4">
          {profile.avatarChampionId && ddVersion && (
            <img
              src={championIconUrl(profile.avatarChampionId, ddVersion)}
              alt=""
              className="h-12 w-12 shrink-0 outline outline-gold5/60 -outline-offset-1 md:h-14 md:w-14"
            />
          )}
          <h1 className="min-w-0 break-words font-serif text-4xl font-bold text-gold1 md:text-5xl">
            {profile.username ?? 'Your Profile'}
          </h1>
        </div>
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
      {active === 'account' && (
        <AccountTab me={me} settled={meSettled} onChange={setMe} />
      )}
    </div>
  )
}
