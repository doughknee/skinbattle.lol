import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import LogoutButton from '~/components/LogoutButton'
import DeleteAccountButton from '~/components/DeleteAccountButton'
import AuthPrompt from '~/components/AuthPrompt'
import type { Me } from '~/lib/types'

export const Route = createFileRoute('/account')({
  head: () => ({
    meta: [{ title: 'Account — Skin Battle' }],
  }),
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
    return (
      <div className="container mx-auto flex min-h-[70vh] items-center justify-center px-6 pt-28">
        <p
          className="animate-pulse font-serif text-lg italic text-gold2"
          role="status"
        >
          Summoning your account...
        </p>
      </div>
    )

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
    </div>
  )
}
