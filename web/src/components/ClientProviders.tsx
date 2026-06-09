import { LogtoProvider } from '@logto/react'
import type { ReactNode } from 'react'
import { logtoConfig } from '~/lib/logto'

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <LogtoProvider config={logtoConfig}>{children}</LogtoProvider>
}
