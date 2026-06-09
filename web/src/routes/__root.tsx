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
import ChampionSearch from '~/components/ChampionSearch'
import UserStats from '~/components/UserStats'

export const Route = createRootRoute({
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
  return (
    <RootDocument>
      <ClientProviders>
        <NavBar />
        <Outlet />
        <ChampionSearch />
        <UserStats />
      </ClientProviders>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className="bg-linear-220 from-gradientTop via-[#0A1428] to-gradientBottom bg-fixed"
    >
      <head>
        <HeadContent />
      </head>
      <body className="antialiased min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
