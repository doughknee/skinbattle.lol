import { createFileRoute } from '@tanstack/react-router'

// Server-only route: /sitemap.xml for crawlers, generated from the site-map
// registry and the live catalog. See lib/games/server/sitemap.ts.
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const { sitemapXmlResponse } = await import('~/lib/games/server/sitemap')
        return sitemapXmlResponse()
      },
    },
  },
})
