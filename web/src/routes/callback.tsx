import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useHandleSignInCallback, useLogto } from '@logto/react'
import { usePostHog } from 'posthog-js/react'
import { useAuth, sessionExpiredStore } from '~/lib/useAuth'
import { Spinner } from '~/components/Skeletons'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

export const Route = createFileRoute('/callback')({
  // SSR is meaningless for an OIDC redirect handler - render only on the client.
  // The pendingComponent doubles as the SSR/pre-hydration fallback for
  // ssr: false routes, so the spinner paints immediately instead of a blank
  // shell while the bundle loads.
  ssr: false,
  component: CallbackPage,
  pendingComponent: Reconnecting,
})

function Reconnecting() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-linear-220 from-gradientTop via-blue7 to-gradientBottom">
      <Spinner className="h-10 w-10" />
      <p
        className="animate-pulse text-3xl font-serif font-bold text-gold2"
        role="status"
      >
        Reconnecting to the Rift...
      </p>
    </div>
  )
}

function CallbackPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const posthog = usePostHog()
  const { getIdTokenClaims } = useLogto()
  const [stranded, setStranded] = useState(false)
  const { isAuthenticated, isLoading, error } = useHandleSignInCallback(async () => {
    // Successful sign-in → identify the user in PostHog, then go home.
    sessionExpiredStore.set(false)
    try {
      const claims = await getIdTokenClaims()
      if (claims?.sub) {
        posthog.identify(claims.sub, {
          email: claims.email,
          username: claims.username,
          player_tier: 'member',
        })
        // Flip the super-property immediately so events between here and the
        // next render carry 'member'. user_signed_in fires ONLY after a
        // successful identify - otherwise it would land on the anonymous id
        // and corrupt the sign-up conversion funnel.
        posthog.register({ is_authenticated: true, player_tier: 'member' })
        posthog.capture('user_signed_in')
      }
    } catch {
      /* non-fatal: analytics shouldn't block navigation */
    }
    navigate({ to: '/' })
  })

  // Already signed in (e.g. revisiting /callback after the redirect was
  // consumed) - there's nothing to process, go home.
  useEffect(() => {
    if (!isLoading && isAuthenticated && !error) {
      navigate({ to: '/' })
    }
  }, [isLoading, isAuthenticated, error, navigate])

  // Landing here without a pending sign-in session (refreshed mid-login,
  // bookmarked URL, new tab) never triggers processing - no error, no
  // navigation, spinner forever. If nothing is happening, bail out.
  useEffect(() => {
    if (isLoading || isAuthenticated || error) return
    const timer = setTimeout(() => setStranded(true), 3000)
    return () => clearTimeout(timer)
  }, [isLoading, isAuthenticated, error])

  // A failed callback (refreshed mid-login, expired or reused link) used to
  // strand the user on the spinner forever - give them a way out.
  if (error || stranded) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-linear-220 from-gradientTop via-blue7 to-gradientBottom px-6 text-center">
        <p className="font-serif text-3xl font-bold text-gold2">
          Sign-in didn&apos;t complete
        </p>
        <p className="max-w-md text-sm text-grey1">
          This can happen if the page was refreshed mid-login or the link
          expired. Trying again usually fixes it.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <button type="button" onClick={login} className={btnPrimarySm}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className={btnSecondarySm}
          >
            Go home
          </button>
        </div>
      </div>
    )
  }

  return <Reconnecting />
}
