#!/bin/sh
# Applies pending migrations (idempotent), then starts Next. Set SKIP_MIGRATIONS=1 if Coolify runs them as a pre-deploy command.
set -e
if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  node cli/migrate.mjs
fi
exec node server.js
