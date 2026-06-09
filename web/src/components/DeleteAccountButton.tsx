import { useState } from 'react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'

export default function DeleteAccountButton() {
  const { getApiToken, logout } = useAuth()
  const [errorMsg, setErrorMsg] = useState('')

  const handleDelete = async () => {
    if (
      !window.confirm(
        'Are you sure you want to delete your account? This action cannot be undone.',
      )
    ) {
      return
    }
    try {
      const token = await getApiToken()
      if (!token) throw new Error('Not authenticated')
      await api.deleteAccount(token)
      // After successful deletion, sign out (clears the Logto session).
      logout()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to delete account')
    }
  }

  return (
    <div>
      <button
        onClick={handleDelete}
        className="bg-hextech-black/30 border-2 border-transparent outline-icon/30 outline -outline-offset-2 hover:border-icon hover:border-2 transition duration-150 font-serif text-grey1 hover:text-gold1 text-lg font-bold px-8 py-4 shadow-lg"
      >
        Delete Account
      </button>
      {errorMsg && <p className="text-red-500 mt-2">{errorMsg}</p>}
    </div>
  )
}
