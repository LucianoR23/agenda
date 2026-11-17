#!/bin/sh
# Applies pending migrations (idempotent), then starts Next. Set SKIP_MIGRATIONS=true if Coolify runs them as a pre-deploy command.
set -e
case "${SKIP_MIGRATIONS:-false}" in
  1 | true | yes | on) ;;
  *) node cli/migrate.mjs ;;
esac
# `localhost` resolves to ::1 on Alpine (Coolify's healthcheck uses it): listen dual-stack when IPv6 is available.
if [ "$HOSTNAME" = "0.0.0.0" ] && grep -q 00000000000000000000000000000001 /proc/net/if_inet6 2>/dev/null; then
  export HOSTNAME=::
fi
exec node server.js
