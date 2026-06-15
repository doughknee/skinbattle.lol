import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '~/lib/useAuth'

// Global "create an account to vote" popup. Call openLoginPrompt() from
// anywhere a signed-out action needs a nudge; <LoginPrompt /> (mounted once in
// the root) renders the overlay. Keeping it global lets the star/ban controls
// render identically signed in or out - no per-card sign-in button, no layout
// shift - and the gate is a popup, not a redirect-on-click.

interface LoginPromptDetail {
  title?: string
  message?: string
}

const EVENT = 'sb:loginprompt'

export function openLoginPrompt(detail: LoginPromptDetail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
}

export default function LoginPrompt() {
  const { login } = useAuth()
  const [detail, setDetail] = useState<LoginPromptDetail | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => setDetail((e as CustomEvent).detail ?? {})
    window.addEventListener(EVENT, onOpen)
    return () => window.removeEventListener(EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!detail) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetail(null)
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.style.overflow = prevOverflow
    }
  }, [detail])

  if (!detail) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to vote"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-hextech-black/90 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setDetail(null)
      }}
    >
      <div className="animate-pop relative w-full max-w-md border-t-2 border-t-gold5 bg-hextech-black/95 p-7 text-center shadow-2xl outline outline-icon/30 -outline-offset-1">
        <button
          onClick={() => setDetail(null)}
          aria-label="Close"
          title="Close (Esc)"
          className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center text-grey1 outline outline-icon/30 -outline-offset-1 hover:text-gold1 hover:outline-icon transition duration-150"
        >
          <FontAwesomeIcon icon={faXmark} className="h-4" />
        </button>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gold5/15 outline outline-gold2/50 -outline-offset-2">
          <FontAwesomeIcon icon={faStar} className="h-6 text-gold1" />
        </div>
        <h2 className="font-serif text-2xl font-bold text-gold1">
          {detail.title ?? 'Spend your stars and bans'}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-grey1">
          {detail.message ??
            'Create a free account to star the skins you love and ban the ones you don’t: 10 of each to spend, and every vote shapes the rankings.'}
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={() => {
              setDetail(null)
              login()
            }}
            className="h-12 w-full cursor-pointer bg-gold5/25 font-serif text-base font-bold text-gold1 outline outline-gold2/60 -outline-offset-1 hover:bg-gold5/45 hover:outline-gold2 transition duration-150"
          >
            Sign in or create account
          </button>
          <button
            onClick={() => setDetail(null)}
            className="h-10 w-full cursor-pointer text-sm font-bold text-grey1 hover:text-gold1 transition duration-150"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}
