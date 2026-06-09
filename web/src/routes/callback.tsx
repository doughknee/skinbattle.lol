import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useHandleSignInCallback } from '@logto/react'

export const Route = createFileRoute('/callback')({
  // SSR is meaningless for an OIDC redirect handler — render only on the client.
  ssr: false,
  component: CallbackPage,
})

function CallbackPage() {
  const navigate = useNavigate()
  const { isLoading } = useHandleSignInCallback(() => {
    // Successful sign-in → back to home.
    navigate({ to: '/' })
  })

  useEffect(() => {
    // no-op; useHandleSignInCallback drives the flow
  }, [isLoading])

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed">
      <p className="text-3xl font-serif font-bold text-gold2">
        Reconnecting to the Rift...
      </p>
    </div>
  )
}
