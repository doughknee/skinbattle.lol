import { useAuth } from '~/lib/useAuth'

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
      <button
        onClick={login}
        className="bg-gold5/20 border-2 border-transparent outline outline-gold2/60 -outline-offset-2 hover:outline-gold2 hover:bg-gold5/40 transition duration-150 font-serif text-gold1 text-lg font-bold px-8 py-4 shadow-lg cursor-pointer"
      >
        Sign In
      </button>
    </div>
  )
}
