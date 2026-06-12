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
