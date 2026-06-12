import { useState } from 'react'
import { api } from '~/lib/api'
import { useAuth } from '~/lib/useAuth'
import { btnDanger } from '~/lib/ui'

export default function DeleteAccountButton() {
  const { withApiToken, logout } = useAuth()
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
      await withApiToken((token) => api.deleteAccount(token))
      // After successful deletion, sign out (clears the Logto session).
      logout()
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to delete account')
    }
  }

  return (
    <div>
      <button onClick={handleDelete} className={`${btnDanger} w-full`}>
        Delete Account
      </button>
      {errorMsg && <p className="mt-3 text-sm text-danger">{errorMsg}</p>}
    </div>
  )
}
