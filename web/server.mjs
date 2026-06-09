// Production Node server for the TanStack Start SSR build.
//
// This version of @tanstack/react-start (1.168.x, Vite 7) emits a Web-Fetch
// style SSR handler at dist/server/server.js (default export with `.fetch`)
// plus static client assets under dist/client. We use `srvx` (already part of
// the TanStack Start dependency tree) to serve the static assets first and
// fall through to the SSR handler for everything else.
import { serve } from 'srvx'
import { serveStatic } from 'srvx/static'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ssr = (await import('./dist/server/server.js')).default

const clientDir = join(__dirname, 'dist', 'client')

const port = Number(process.env.PORT) || 3000

serve({
  port,
  hostname: '0.0.0.0',
  // Serve hashed client assets straight from disk; SSR handles the rest.
  middleware: [serveStatic({ dir: clientDir })],
  fetch: (request) => ssr.fetch(request),
})

console.log(`▲ skinbattle web listening on http://0.0.0.0:${port}`)
