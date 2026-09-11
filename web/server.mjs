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

// Same-origin PostHog reverse proxy. The browser sends events to /ingest (see
// ClientProviders api_host) so ad-blockers can't drop a third-party host. In dev
// vite.config.ts proxies these paths; in prod that proxy doesn't run, so we
// mirror it here. /ingest/static + /ingest/array serve the JS bundle from the
// assets host; everything else (capture, flags, surveys) hits the ingest host.
const POSTHOG_INGEST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
const POSTHOG_ASSETS = 'https://us-assets.i.posthog.com'

async function posthogProxy(request, next) {
  const url = new URL(request.url)
  if (url.pathname !== '/ingest' && !url.pathname.startsWith('/ingest/')) {
    return next()
  }
  const useAssets =
    url.pathname.startsWith('/ingest/static') ||
    url.pathname.startsWith('/ingest/array')
  const target = useAssets ? POSTHOG_ASSETS : POSTHOG_INGEST
  const upstream = target + url.pathname.replace(/^\/ingest/, '') + url.search

  // Drop hop-by-hop + host so fetch sets Host from the upstream URL (changeOrigin).
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('connection')

  const init = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }

  const res = await fetch(upstream, init)
  // undici auto-decompresses the body but leaves content-encoding/length set,
  // which would make the browser try to gunzip already-plain bytes. Strip them.
  const respHeaders = new Headers(res.headers)
  respHeaders.delete('content-encoding')
  respHeaders.delete('content-length')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
  })
}

// IndexNow key file. IndexNow verifies ownership by fetching
// https://<host>/<key>.txt and checking it contains the key. Serving it from
// the env var rather than committing web/public/<key>.txt means the key is
// never in git and rotating it is a restart - the same runtime-env contract
// Logto and PostHog already use here. Unset → the path 404s like any other.
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || ''

function indexNowKeyFile(request, next) {
  if (!INDEXNOW_KEY) return next()
  if (new URL(request.url).pathname !== `/${INDEXNOW_KEY}.txt`) return next()
  return new Response(INDEXNOW_KEY, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

// One canonical host. Every page already declares https://skinbattle.lol/...
// as its canonical URL, so a www request is answered with a permanent
// redirect to the same path on the apex, query string intact. This only runs
// once the proxy routes the www host here at all - Coolify has to list
// https://www.skinbattle.lol on the web service (which also issues its
// certificate); see DEPLOY.md, "Canonical host".
const CANONICAL_HOST = process.env.CANONICAL_HOST || 'skinbattle.lol'

function canonicalHost(request, next) {
  const url = new URL(request.url)
  const host = (request.headers.get('x-forwarded-host') || url.host)
    .split(',')[0]
    .trim()
  if (host !== `www.${CANONICAL_HOST}`) return next()
  return Response.redirect(
    `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
    301,
  )
}

serve({
  port,
  hostname: '0.0.0.0',
  // Host canonicalisation, the PostHog proxy and the IndexNow key file first,
  // then hashed client assets from disk; SSR handles the rest.
  middleware: [
    canonicalHost,
    posthogProxy,
    indexNowKeyFile,
    serveStatic({ dir: clientDir }),
  ],
  fetch: (request) => ssr.fetch(request),
})

console.log(`▲ skinbattle web listening on http://0.0.0.0:${port}`)
