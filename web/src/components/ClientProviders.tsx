import { useState } from 'react'
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
  // Build the Logto config exactly once: LogtoProvider memoizes its client on
  // the config OBJECT, so a fresh object on any re-render (root loader
  // re-runs on navigation) would construct a brand-new Logto client mid-flight
  // and drop the existing auth state.
  const [logtoConfig] = useState(() => makeLogtoConfig(config))
  return (
    <LogtoProvider config={logtoConfig} LogtoClientClass={CrossTabLogtoClient}>
      {children}
    </LogtoProvider>
  )
}
