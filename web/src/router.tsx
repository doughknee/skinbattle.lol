import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Show route skeletons quickly (default is a full second of blank
    // waiting), but once shown keep them up briefly so they don't flash.
    defaultPendingMs: 200,
    defaultPendingMinMs: 400,
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
