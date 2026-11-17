# Runbook — back up and restore only the `agenda` database

Backups of `postgres-core` are scheduled by the sunday repo (whole instance). This page covers taking a dump of just
`agenda` and restoring it without touching the other databases.

## Take a dump

From the Coolify terminal of `postgres-core` (or any machine that can reach it):

```bash
pg_dump -U postgres -d agenda --format=custom --no-owner --file=/tmp/agenda-$(date +%F).dump
```

Copy it off the server (Coolify → Terminal → download, or `docker cp`). The dump contains PIN and token *hashes* and
encrypted Google tokens, not plain secrets, but treat it as sensitive.

## Restore

1. Stop the agenda app in Coolify (so nothing writes during the restore).
2. Recreate the database:

   ```sql
   -- psql -U postgres
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'agenda';
   DROP DATABASE agenda;
   CREATE DATABASE agenda OWNER agenda;
   ```

3. Restore as the owner:

   ```bash
   pg_restore -U agenda -d agenda --no-owner --exit-on-error /tmp/agenda-YYYY-MM-DD.dump
   ```

4. Start the app. The entrypoint runs pending migrations, if the dump is older than the code.
5. Check `https://agenda.lemydev.com/api/health` and open the app. Sessions, passkeys, API tokens and push
   subscriptions come back with the data; devices only need the PIN again if they had been idle past
   `PIN_REAUTH_DAYS`.

## Restore into a scratch database (to inspect)

```bash
createdb -U postgres -O agenda agenda_restore_check
pg_restore -U agenda -d agenda_restore_check --no-owner /tmp/agenda-YYYY-MM-DD.dump
# … inspect …
dropdb -U postgres agenda_restore_check
```
