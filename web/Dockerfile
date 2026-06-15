# ── Build stage ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies (use lockfile if present for reproducible installs)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build. Public config (Logto endpoint/app/resource, API URL) is
# injected at RUNTIME via env vars (see src/lib/config.ts + routes/__root.tsx),
# so no per-environment build args are needed here.
COPY . .

# Motion+ (paid) is intentionally absent from package.json/lockfile - its
# install URL carries a license token we never commit. Install it here, into
# this build stage's node_modules, so Vite can bundle the odometer into the
# client chunks (it's client-only, so it never reaches the runtime image).
# MOTION_PLUS_TOKEN must be set as a Coolify *build* variable: the script needs
# it to fetch the package, and `npm run build` below hard-fails without
# motion-plus ("Rollup failed to resolve import 'motion-plus/react'").
ARG MOTION_PLUS_TOKEN
RUN MOTION_PLUS_TOKEN="$MOTION_PLUS_TOKEN" npm run motion-plus

RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# This TanStack Start build emits a Web-Fetch SSR handler under dist/ plus
# static client assets; server.mjs (using srvx) ties them together. We need the
# production node_modules at runtime for srvx + the server bundle's externals.
COPY --from=build /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs
# OG share-card fonts (lib/games/server/og.ts reads them at runtime).
COPY --from=build /app/assets ./assets

EXPOSE 3000

# Runtime env (API_INTERNAL_URL) is injected by the orchestrator.
CMD ["node", "server.mjs"]
