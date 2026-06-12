import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Spinner } from '~/components/Skeletons'
import { toast } from '~/components/Toaster'
import { useAuth } from '~/lib/useAuth'
import { accountApi, type AccountApiError } from '~/lib/accountApi'
import { clearSocialLinkStash, loadSocialLinkStash } from '~/lib/socialLink'
import { btnChip } from '~/lib/ui'

// Where Discord/Google land after the user approves connecting their
// account (the redirectUri SecuritySettings registered with Logto's social
// verification). Finishes the link: verify the OAuth callback with Logto,
// then bind the identity using the proof stashed before the redirect.
// This exact URL must be registered in each provider's dev portal - see
// DEPLOY.md.
export const Route = createFileRoute('/social-callback')({
  ssr: false,
  component: SocialCallback,
})

function SocialCallback() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, getAccountToken } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (isLoading || ran.current) return
    ran.current = true

    const back = () => navigate({ to: '/profile', search: { tab: 'account' } })

    void (async () => {
      const stash = loadSocialLinkStash()
      if (!stash) {
        // Nothing in flight (deep link, double-visit after success) - just
        // go where the user manages connections.
        void back()
        return
      }

      const params = Object.fromEntries(
        new URLSearchParams(window.location.search),
      )

      // The provider reports denial/cancellation in the query string.
      if (params.error) {
        clearSocialLinkStash()
        toast(`${stash.name} connection was cancelled.`, 'error')
        void back()
        return
      }
      if (!params.state || params.state !== stash.state) {
        clearSocialLinkStash()
        setError('The sign-in state didn’t match. Please try again.')
        return
      }
      if (!isAuthenticated) {
        setError('Please sign in, then try connecting again.')
        return
      }

      try {
        const token = await getAccountToken()
        if (!token) throw new Error('Please sign in again.')
        const verified = await accountApi.verifySocialVerification(
          token,
          stash.verificationRecordId,
          { ...params, redirectUri: stash.redirectUri },
        )
        await accountApi.linkIdentity(
          token,
          stash.proofId,
          verified.verificationRecordId,
        )
        clearSocialLinkStash()
        toast(`${stash.name} connected`, 'success')
        void back()
      } catch (err) {
        clearSocialLinkStash()
        const apiErr = err as AccountApiError
        setError(
          apiErr.code === 'user.identity_already_in_use'
            ? `That ${stash.name} account is already connected to a different skinbattle.lol account.`
            : apiErr.status === 400 || apiErr.status === 401
              ? 'The connection attempt expired. Please try again.'
              : err instanceof Error && err.message
                ? err.message
                : "Couldn't finish connecting your account.",
        )
      }
    })()
  }, [isLoading, isAuthenticated, getAccountToken, navigate])

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
      {error ? (
        <>
          <h1 className="font-serif text-2xl font-bold text-gold1">
            Connection failed
          </h1>
          <p className="max-w-md text-sm text-grey1">{error}</p>
          <button
            onClick={() =>
              navigate({ to: '/profile', search: { tab: 'account' } })
            }
            className={btnChip}
          >
            Back to profile
          </button>
        </>
      ) : (
        <>
          <Spinner className="h-8 w-8" />
          <p className="text-sm text-grey1">Connecting your account…</p>
        </>
      )}
    </main>
  )
}
