import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import LogoutButton from '~/components/LogoutButton'
import DeleteAccountButton from '~/components/DeleteAccountButton'
import AuthPrompt from '~/components/AuthPrompt'
import type { Me } from '~/lib/types'

export const Route = createFileRoute('/account')({
  component: AccountPage,
})

function AccountPage() {
  const { isAuthenticated, isLoading, getApiToken } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (isLoading) return
      if (!isAuthenticated) {
        setLoadingMe(false)
        return
      }
      const token = await getApiToken()
      if (!token) {
        setLoadingMe(false)
        return
      }
      try {
        const data = await api.me(token)
        if (!cancelled) setMe(data)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingMe(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, getApiToken])

  if (isLoading || loadingMe)
    return <p className="pt-36 text-center text-grey1">Loading...</p>

  if (!isAuthenticated)
    return (
      <AuthPrompt
        title="Account"
        message="Sign in to manage your account and track your votes."
      />
    )

  return (
    <div className="container mx-auto px-6 pt-28 min-h-[70vh] flex flex-col items-center justify-center">
      <h1 className="text-4xl md:text-5xl font-serif font-bold mb-10 text-gold2">
        Account
      </h1>

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

        <div className="flex flex-col gap-4">
          <LogoutButton />
          <DeleteAccountButton />
        </div>
      </div>
    </div>
  )
}
