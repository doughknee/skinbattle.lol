import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useHandleSignInCallback } from '@logto/react'
import { useAuth, sessionExpiredStore } from '~/lib/useAuth'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

export const Route = createFileRoute('/callback')({
  // SSR is meaningless for an OIDC redirect handler — render only on the client.
  ssr: false,
  component: CallbackPage,
})

function CallbackPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [stranded, setStranded] = useState(false)
  const { isAuthenticated, isLoading, error } = useHandleSignInCallback(() => {
    // Successful sign-in → fresh session, back to home.
    sessionExpiredStore.set(false)
    navigate({ to: '/' })
  })

  // Already signed in (e.g. revisiting /callback after the redirect was
  // consumed) — there's nothing to process, go home.
  useEffect(() => {
    if (!isLoading && isAuthenticated && !error) {
      navigate({ to: '/' })
    }
  }, [isLoading, isAuthenticated, error, navigate])

  // Landing here without a pending sign-in session (refreshed mid-login,
  // bookmarked URL, new tab) never triggers processing — no error, no
  // navigation, spinner forever. If nothing is happening, bail out.
  useEffect(() => {
    if (isLoading || isAuthenticated || error) return
    const timer = setTimeout(() => setStranded(true), 3000)
    return () => clearTimeout(timer)
  }, [isLoading, isAuthenticated, error])

  // A failed callback (refreshed mid-login, expired or reused link) used to
  // strand the user on the spinner forever — give them a way out.
  if (error || stranded) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed px-6 text-center">
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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed">
      <p
        className="animate-pulse text-3xl font-serif font-bold text-gold2"
        role="status"
      >
        Reconnecting to the Rift...
      </p>
    </div>
  )
}
