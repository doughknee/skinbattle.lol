// Installs the Motion+ (`motion-plus`) private package WITHOUT writing the
// license token into any committed file.
//
// Motion+ is distributed as a tokenized tarball URL. Running the documented
// `npm install "https://api.motion.dev/...&token=XXX"` would persist that token
// into package.json + package-lock.json (a committed secret leak). Instead we
// take the token from the MOTION_PLUS_TOKEN env var and install with --no-save,
// so the URL (and token) never touch package.json or the lockfile.
//
// Setup (once): put your token in the environment, NOT in a committed file:
//   export MOTION_PLUS_TOKEN=...        # shell profile, or a gitignored .env, or a CI secret
// Then, after `npm install`, run:
//   npm run motion-plus
// CI must run `npm run motion-plus` after `npm install` with MOTION_PLUS_TOKEN set.

import { execSync } from 'node:child_process'

const token = process.env.MOTION_PLUS_TOKEN
const version = process.env.MOTION_PLUS_VERSION ?? '2.10.0'

if (!token) {
  console.warn(
    '[motion-plus] MOTION_PLUS_TOKEN not set — skipping. AnimateNumber (the daily countdown) needs it: set the env var and re-run `npm run motion-plus`.',
  )
  process.exit(0)
}

const url = `https://api.motion.dev/registry.tgz?package=motion-plus&version=${version}&token=${token}`
execSync(`npm install "${url}" --no-save --no-audit --no-fund`, {
  stdio: 'inherit',
})
console.log('[motion-plus] installed into node_modules (token not persisted to any file)')
