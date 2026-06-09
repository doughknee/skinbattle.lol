# ── Build stage ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies (use lockfile if present for reproducible installs)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build
COPY . .

# VITE_* vars are baked into the client bundle at build time.
# Provide them as build args so Coolify/CI can inject per-environment values.
ARG VITE_API_URL=/api
ARG VITE_LOGTO_ENDPOINT
ARG VITE_LOGTO_APP_ID
ARG VITE_LOGTO_RESOURCE
ENV VITE_API_URL=$VITE_API_URL \
    VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT \
    VITE_LOGTO_APP_ID=$VITE_LOGTO_APP_ID \
    VITE_LOGTO_RESOURCE=$VITE_LOGTO_RESOURCE

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

EXPOSE 3000

# Runtime env (API_INTERNAL_URL) is injected by the orchestrator.
CMD ["node", "server.mjs"]
