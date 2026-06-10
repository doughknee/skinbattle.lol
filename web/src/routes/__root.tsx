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
import Lightbox from '~/components/Lightbox'
import Footer from '~/components/Footer'
import { readServerConfig, type PublicConfig } from '~/lib/config'

const SITE_URL = 'https://skinbattle.lol'
const SITE_TITLE = 'SKINBATTLE.LOL — League of Legends Skin Rankings'
const SITE_DESCRIPTION =
  'Community-built rankings for every League of Legends skin. Upvote, star, and ban your way to the definitive list.'

export const Route = createRootRoute({
  // Runs on the server during SSR; the result is serialized to the client, so
  // browser navigations reuse the same values without re-reading env.
  loader: () => ({ config: readServerConfig() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: SITE_TITLE },
      { name: 'description', content: SITE_DESCRIPTION },
      { name: 'theme-color', content: '#0A1428' },
      // Open Graph / Twitter cards — what Reddit and Discord shares render.
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'SKINBATTLE.LOL' },
      { property: 'og:title', content: SITE_TITLE },
      { property: 'og:description', content: SITE_DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: `${SITE_URL}/og-image.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: SITE_TITLE },
      { name: 'twitter:description', content: SITE_DESCRIPTION },
      { name: 'twitter:image', content: `${SITE_URL}/og-image.png` },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800&family=Marcellus&display=swap',
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
        <Lightbox />
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
