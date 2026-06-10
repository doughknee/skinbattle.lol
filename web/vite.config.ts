import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 3000,
    // Dev: proxy browser-side /api calls to the Go API so dev mirrors the
    // production same-origin setup (no CORS). SSR loaders use API_INTERNAL_URL.
    proxy: {
      '/api': {
        // DEV_API_PROXY lets you point dev at a remote API (e.g. the live
        // one) instead of a locally running Go service.
        target: process.env.DEV_API_PROXY || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  css: {
    // We use the @tailwindcss/vite plugin, not PostCSS. Setting an explicit
    // (empty) postcss config stops Vite from walking up to the parent repo's
    // postcss.config.mjs (which references the Next.js app's deps).
    postcss: {},
  },
  plugins: [
    // tsConfigPaths so that the "~/*" alias resolves
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
