import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Standalone test config so the suite doesn't load the full app build pipeline
// (TanStack Start plugin, native OG bindings). Just the `~/*` path alias and a
// Node environment — enough for pure-logic tests like the brand drift guard.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // scripts/ holds the unattended .mjs jobs the GitHub workflows run.
    // They sit outside tsconfig's `include`, so vitest is their only gate.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
})
