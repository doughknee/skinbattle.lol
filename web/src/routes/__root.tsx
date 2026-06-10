import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import '~/lib/fontawesome'
import globalCss from '~/styles/globals.css?url'
import ClientProviders from '~/components/ClientProviders'
import NavBar from '~/components/Navbar'
import CommandPalette from '~/components/CommandPalette'
import Toaster from '~/components/Toaster'
import Footer from '~/components/Footer'
import { readServerConfig, type PublicConfig } from '~/lib/config'

export const Route = createRootRoute({
  // Runs on the server during SSR; the result is serialized to the client, so
  // browser navigations reuse the same values without re-reading env.
  loader: () => ({ config: readServerConfig() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Skin Battle' },
      { name: 'description', content: 'Vote on your favorite LoL skins' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800&display=swap',
      },
      { rel: 'stylesheet', href: globalCss },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { config } = Route.useLoaderData()
  return (
    <RootDocument config={config}>
      <ClientProviders config={config}>
        <NavBar />
        <Outlet />
        <Footer />
        <CommandPalette />
        <Toaster />
      </ClientProviders>
    </RootDocument>
  )
}

function RootDocument({
  children,
  config,
}: {
  children: ReactNode
  config: PublicConfig
}) {
  return (
    <html
      lang="en"
      className="bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed"
    >
      <head>
        <HeadContent />
        {/* Runtime public config — read by the browser before the app bundle.
            Sourced from loader data so SSR and client render identically. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `window.__APP_CONFIG__=${JSON.stringify(config).replace(/</g, '\\u003c')}`,
          }}
        />
      </head>
      <body className="antialiased min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
