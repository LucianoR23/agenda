# syntax=docker/dockerfile:1.7
# Agenda — production image for linux/arm64 (Oracle Cloud Ampere). Also builds on amd64.
#   docker buildx build --platform linux/arm64 -t agenda .
ARG NODE_VERSION=24-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable
ARG APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1 APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && node scripts/build-cli.mjs

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=America/Buenos_Aires APP_VERSION=${APP_VERSION} \
    COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm available in the container terminal (`pnpm auth:reset-pin`), prepared at build time (no network at runtime)
RUN apk add --no-cache tzdata && corepack enable && corepack prepare pnpm@11.17.0 --activate \
  && chmod -R a+rX /opt/corepack && addgroup -S agenda && adduser -S agenda -G agenda

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
