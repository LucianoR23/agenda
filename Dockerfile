# syntax=docker/dockerfile:1.7
# Agenda — production image for linux/arm64 (Oracle Cloud Ampere). Also builds on amd64.
#   docker buildx build --platform linux/arm64 -t agenda .
ARG NODE_VERSION=26-alpine
# Node 25+ no longer ships corepack: pnpm is installed with npm, pinned to package.json's packageManager.
ARG PNPM_VERSION=11.17.0

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN npm install -g pnpm@${PNPM_VERSION} --no-fund --no-audit
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:${NODE_VERSION} AS build
ARG PNPM_VERSION
WORKDIR /app
RUN npm install -g pnpm@${PNPM_VERSION} --no-fund --no-audit
# the commit, from Coolify ("Include Source Commit in Build") or CI: stamped into the build version (next.config.ts)
ARG SOURCE_COMMIT=
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && node scripts/build-cli.mjs

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
ARG PNPM_VERSION
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=America/Buenos_Aires
# pnpm available in the container terminal (`pnpm auth:reset-pin`), installed at build time (no network at runtime)
RUN apk add --no-cache tzdata && npm install -g pnpm@${PNPM_VERSION} --no-fund --no-audit && npm cache clean --force \
  && addgroup -S agenda && adduser -S agenda -G agenda

COPY --from=build --chown=agenda:agenda /app/.next/standalone ./
COPY --from=build --chown=agenda:agenda /app/.next/static ./.next/static
COPY --from=build --chown=agenda:agenda /app/public ./public
COPY --from=build --chown=agenda:agenda /app/drizzle ./drizzle
COPY --from=build --chown=agenda:agenda /app/dist-cli ./cli
# the native Argon2 addon for this platform (the CLIs load it from here)
COPY --from=build --chown=agenda:agenda /app/node_modules/@node-rs ./node_modules/@node-rs
COPY --chown=agenda:agenda docker/package.json docker/pnpm-workspace.yaml ./
COPY --chown=agenda:agenda --chmod=755 docker/entrypoint.sh ./entrypoint.sh

USER agenda
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["./entrypoint.sh"]
