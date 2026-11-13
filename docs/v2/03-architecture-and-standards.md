# 03 — Architecture and standards

## Structure (keep v1's shape)
```
src/
  app/                    Next 16 App Router (UI routes; api/[...path]/route.ts catch-all)
  contract/               Zod schemas + route catalogue (single source of truth)
    schemas/              task, reminder, event, habit, sleep, review, settings, auth, token, common
    routes/               operation definitions: method, path, access, tags, request/response schemas
    openapi.ts            generates /api/openapi.json and /api/openapi.sunday.json
  server/
    http/                 router/dispatcher, access control, errors, CORS, rate limit, origin check
    auth/                 PIN, sessions, devices, WebAuthn, recovery, api tokens
    db/                   drizzle schema, client, migrations
    domain/               tasks, reminders, events, calendar-sync, habits, sleep, review, metrics, time
    jobs/                 worker loop: reminders, calendar sync, pruning
    push/                 web-push sending, payload building, action tokens
  client/                 api client (generated types), TanStack Query hooks, Dexie, outbox sync
  ui/                     components (Calma design system), screens
public/sw.js              service worker
docker/                   entrypoint
```

## Request flow
`route.ts` → `router.ts` matches the operation from the catalogue → access check (`public` | `preauth` | `user` session | `token` with scopes | `internal`) → Zod validation → domain function (pure-ish, receives a db/tx and a clock) → Zod-validated response. Errors: `{ "error": { "code": "TASK_NOT_FOUND", "message": "<human/LLM-readable Spanish or English sentence>", "details"?: {} } }` with proper HTTP status.

## Tooling
- **Biome** replaces ESLint (lint + format). `biome.json` with recommended rules, organize imports, 2-space, double quotes, trailing commas. Scripts: `pnpm check` (biome check), `pnpm fix`.
- **React Compiler** enabled (`reactCompiler: true` in `next.config.ts`; `babel-plugin-react-compiler`). Remove manual `useMemo`/`useCallback` only where safe; don't mass-refactor.
- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (if the cost is reasonable; ask).
- Scripts: `dev`, `build`, `start`, `typecheck`, `check`, `fix`, `test`, `test:e2e`, `db:up`, `db:generate`, `db:migrate`, `openapi:gen`, `openapi:check`, `openapi:lint`.
- Runtime: Node 26 (LTS) with native Temporal; TypeScript 7.
- Update dependencies to current stable at the start of v2 (Next 16.x, React 19.x, drizzle, zod 4, simplewebauthn, etc.) and record versions in the phase summary.

## Time rules
- One module `server/domain/time.ts` (and a client twin) wraps Temporal: `now()`, `today(tz)`, `zoned(dateTime, tz)`, `toInstant`, RRULE expansion helpers.
- Clock is injectable for tests.
- API accepts ISO 8601 with offset for instants; `YYYY-MM-DD` for dates; `HH:mm` only together with a date and the user timezone.
- RRULE: use the `rrule` package (or `rrule-temporal` if it's healthier; decide in plan) with explicit `TZID=America/Buenos_Aires`.

## Testing
- Vitest unit tests for domain (time, recurrence, streaks, scheduler decisions).
- Integration tests hit the router with a real Postgres `agenda_test` (guard: refuse unless DB name ends in `_test`; each test file in a transaction or truncate).
- Contract tests: every response validated with ajv against the generated OpenAPI.
- Playwright: setup → PIN → create task → complete; reminder fires (fake clock / internal trigger); push subscription mocked.
- Gate per phase: `pnpm typecheck && pnpm check && pnpm test && pnpm build`.

## Performance and UX
- Server Components for read-heavy screens where it helps; client components for interactive lists. Respect Next 16 `cacheComponents` semantics (read the local Next docs).
- Optimistic updates via TanStack Query; Dexie as offline cache.
- Target: Hoy screen interactive < 1.5 s on a mid Android over 4G.
