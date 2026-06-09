import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
    // Dev: proxy browser-side /api calls to the Go API so dev mirrors the
    // production same-origin setup (no CORS). SSR loaders use API_INTERNAL_URL.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
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
