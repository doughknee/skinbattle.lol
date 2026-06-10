import { useAuth } from '~/lib/useAuth'
import { btnPrimary } from '~/lib/ui'

// Centered "sign in to continue" gate, shared by auth-only pages.
export default function AuthPrompt({
  title = 'Sign in required',
  message = 'Sign in to continue.',
}: {
  title?: string
  message?: string
}) {
  const { login } = useAuth()
  return (
    <div className="container mx-auto px-6 pt-28 min-h-[70vh] flex flex-col items-center justify-center text-center">
      <h1 className="font-serif text-4xl font-bold text-gold2 mb-3">{title}</h1>
      <p className="text-lg text-grey1 mb-10 max-w-md">{message}</p>
      <button onClick={login} className={btnPrimary}>
        Sign In
      </button>
    </div>
  )
}
