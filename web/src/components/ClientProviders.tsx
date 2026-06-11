import { LogtoProvider } from '@logto/react'
import type { ReactNode } from 'react'
import type { PublicConfig } from '~/lib/config'
import { makeLogtoConfig } from '~/lib/logto'
import { CrossTabLogtoClient } from '~/lib/logtoClient'

export default function ClientProviders({
  children,
  config,
}: {
  children: ReactNode
  config: PublicConfig
}) {
  return (
    <LogtoProvider
      config={makeLogtoConfig(config)}
      LogtoClientClass={CrossTabLogtoClient}
    >
      {children}
    </LogtoProvider>
  )
}
