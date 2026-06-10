import { useAuth } from '~/lib/useAuth'
import { btnSecondarySm } from '~/lib/ui'

export default function LogoutButton() {
  const { logout } = useAuth()

  return (
    <button onClick={logout} className={`${btnSecondarySm} w-full`}>
      Logout
    </button>
  )
}
