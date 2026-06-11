// Custom Logto browser client that serializes token refreshes across tabs.
//
// Logto rotates refresh tokens on every use. Two tabs refreshing at the same
// moment both spend the same single-use refresh token; the loser gets
// `invalid_grant` and reuse detection can revoke the whole grant — surfacing
// to the user as a random logout. A Web Locks API exclusive lock makes one
// tab refresh while the others wait, and re-reading the persisted token map
// inside the lock lets the waiters pick up the fresh access token instead of
// spending another refresh.
import LogtoClient from '@logto/browser'
import type { LogtoConfig } from '@logto/browser'

const REFRESH_LOCK = 'skinbattle:logto-token-refresh'

// The instance LogtoProvider constructs; exposed so useAuth can call the
// client directly and see real errors (the useLogto() proxy swallows them
// and returns undefined).
let currentClient: LogtoClient | null = null

export function getLogtoClient(): LogtoClient | null {
  return currentClient
}

export class CrossTabLogtoClient extends LogtoClient {
  constructor(config: LogtoConfig, unstable_enableCache?: boolean) {
    super(config, unstable_enableCache)
    currentClient = this

    const getWithRefresh = this.getAccessToken.bind(this)
    const locked = async (
      resource?: string,
      organizationId?: string,
    ): Promise<string> => {
      if (typeof navigator === 'undefined' || !navigator.locks) {
        return getWithRefresh(resource, organizationId)
      }
      return navigator.locks.request(REFRESH_LOCK, async () => {
        // Another tab may have refreshed while we waited for the lock — sync
        // from storage so a still-valid access token is reused rather than
        // re-refreshed.
        await (
          this as unknown as { loadAccessTokenMap(): Promise<void> }
        ).loadAccessTokenMap()
        return getWithRefresh(resource, organizationId)
      })
    }
    // The declaration is readonly; replace the instance property at runtime.
    Object.defineProperty(this, 'getAccessToken', { value: locked })
  }
}
