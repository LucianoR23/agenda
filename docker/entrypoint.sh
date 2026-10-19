#!/bin/sh
# Applies pending migrations (idempotent), then starts Next. Set SKIP_MIGRATIONS=1 if Coolify runs them as a pre-deploy command.
set -e
if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  node cli/migrate.mjs
fi
# `localhost` resolves to ::1 on Alpine (Coolify's healthcheck uses it): listen dual-stack when IPv6 is available.
if [ "$HOSTNAME" = "0.0.0.0" ] && grep -q 00000000000000000000000000000001 /proc/net/if_inet6 2>/dev/null; then
  export HOSTNAME=::
fi
exec node server.js
