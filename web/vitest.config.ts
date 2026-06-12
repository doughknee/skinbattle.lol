import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Standalone test config so the suite doesn't load the full app build pipeline
// (TanStack Start plugin, native OG bindings). Just the `~/*` path alias and a
// Node environment — enough for pure-logic tests like the brand drift guard.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
