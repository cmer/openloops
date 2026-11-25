# syntax=docker/dockerfile:1

# Shared base with the toolchain better-sqlite3 needs when no prebuilt binary
# matches the platform.
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./

# Production dependencies only. This layer depends on the lockfile alone, so
# source changes never reinstall it.
FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev --no-audit --no-fund \
  # better-sqlite3 keeps its bundled SQLite sources and C++ files after the
  # build. Only build/Release/*.node and lib/ are loaded at runtime.
  && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
  && find node_modules -type f \( -name '*.md' -o -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete

# Full install plus the build. Copying sources after `npm ci` keeps the install
# cached across code edits.
FROM base AS build
RUN --mount=type=cache,target=/root/.npm \
  npm ci --no-audit --no-fund
COPY tsconfig.server.json tsconfig.client.json vite.config.ts index.html ./
COPY public ./public
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

# Distroless runtime: glibc (matches the bookworm build), node, and nothing
# else. No shell or package manager.
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
# Put node on PATH so `node -e ...` healthchecks in compose files keep working.
ENV PATH=/nodejs/bin:$PATH \
  NODE_ENV=production \
  PORT=4732 \
  DATABASE_PATH=/data/openloops.db
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/shared ./dist/shared
EXPOSE 4732
VOLUME ["/data"]
CMD ["dist/server/index.js"]
