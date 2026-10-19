# Test report (STOP 3)

Run: `pnpm test:coverage` on 2026-10-19 against PostgreSQL 18.6 (docker-compose `db-test`). **89/89 passed**, 9 files, ~20 s.

Every API test goes through the real router (`handle(Request)`) and **every response is validated against the committed `openapi.yaml`** (Ajv, JSON Schema 2020-12): an undocumented status, content type or field fails the test. CI runs the same suite with a Postgres 18 service.

## Coverage (src/server + src/contract)

| Statements | Branches | Functions | Lines |
|---|---|---|---|
| 90.0 % | 78.9 % | 90.2 % | 93.2 % |

Not covered on purpose: successful WebAuthn registration/assertion (needs a real platform authenticator; options, error paths and lockout are tested), real Web Push delivery (`web-push` is swapped for a capturing sender), `migrate.ts` (exercised by the test global setup through drizzle's migrator).

## Spec checklist → tests

| Requirement (§7) | Where |
|---|---|
| Validation errors (problem+json, field paths, strict) | planning: *rejects bad bodies*, *rejects unknown fields*; platform: *invalid JSON and bad If-Match* |
| Idempotent PUT / idempotency replay | planning: *is idempotent…*, *re-sending the same day…* |
| Version conflicts | planning: *If-Match with a stale version*, *day PATCH with body version*; tracking: habit version |
| `calendar_owned` | planning: *calendar blocks: I can't move them*, reorder; unit: ownership |
| `userOverrides` conflicts + `force` | planning: *my edits become userOverrides…*; unit: ownership |
| `locked` | planning: *locked blocks…*; unit: ownership, merge |
| Tracking-field ownership | planning: *tracking fields…*; tracking: habit logs, tasks, sleep halves |
| Proposal create / supersede / accept / reject with preservation | planning: *proposals* (4 tests) |
| Closed-day protection | lifecycle: *closed day: the agent gets day_closed…* |
| Lazy close / close-day cron | lifecycle: *lazy close…*, *close-day cron at 00:05…* |
| Auth (agent / user / none) | auth: *who can call what* |
| PIN lockout (5 → 15 min, doubling) | auth: *5 wrong PINs lock the device…* |
| Recovery code consumption / regeneration | auth: *forgot PIN* |
| Reset-pin CLI code (15 min, single use) | auth: *CLI reset code…* |
| Device re-auth after 7 days | auth: *re-auth after 7 days unused…* |
| Webhook debounce + no-loop + retry | webhook: 4 tests |
| Metrics math with fixtures | metrics: week fixture with hand-computed values |
| Midnight ART edge cases | lifecycle: *midnight in Buenos Aires*; unit: *ART time and midnight edges* |
| Contract (every response vs openapi.yaml) | all API tests; platform: *every operation in the contract is implemented* |

## All tests

### tests/api/planning.test.ts — PUT /days/{date}: validation and idempotency

- ✅ rejects bad bodies with field paths (problem+json)
- ✅ rejects unknown fields (strict)
- ✅ is idempotent: same key + same body replays; same key + other body → 422
- ✅ re-sending the same day without a key is a no-op replace (draft stays the same)
- ✅ draft replace keeps my tracking on matched blocks and never duplicates them

### tests/api/planning.test.ts — version conflicts

- ✅ If-Match with a stale version → 409 version_conflict with the current resource
- ✅ day PATCH with body version

### tests/api/planning.test.ts — ownership

- ✅ calendar blocks: I can't move them (calendar_owned) but I track them
- ✅ my edits become userOverrides; the agent can't overwrite them unless force (logged)
- ✅ locked blocks: the agent can't touch them, not even with force
- ✅ tracking fields: the agent sets them while pending, never over mine
- ✅ by-external mirrors a Google change into every copy (draft: A and B)
- ✅ my blocks: created as mine (all overrides), agent can't delete; reorder is mine
- ✅ Armar mi día: my own day is chosen; the agent's load becomes a proposal

### tests/api/planning.test.ts — proposals

- ✅ chosen/edited day → 202 proposal; supersede; accept preserves tracking and overrides
- ✅ reject leaves the day untouched; ?mode=force applies immediately with preservation
- ✅ a re-plan on a chosen day must include the chosen option
- ✅ tasks in a proposal PUT apply immediately (Q6)
- ✅ a calendar event that disappears is kept if I tracked it, removed otherwise

### tests/api/planning.test.ts — choose and shift

- ✅ choose: switch while chosen, not once edited; agent may choose (Q7)
- ✅ Me atrasé +45 at night moves pareja and sleep past midnight; calendar stays; recorded as shift
- ✅ shift: draft → invalid_transition; out of 00:00–29:59 → 422

### tests/api/lifecycle.test.ts — closing days

- ✅ close-day cron at 00:05 closes yesterday, supersedes its proposal, purges old idempotency keys; idempotent
- ✅ close-day requires X-Internal-Token
- ✅ lazy close: a missed cron never breaks history (first read closes the past day)
- ✅ closed day: the agent gets day_closed; I can still edit (corrections, review)
- ✅ I can close the day early; the agent cannot
- ✅ the agent can't fill my review once set

### tests/api/lifecycle.test.ts — midnight in Buenos Aires

- ✅ 23:59 ART is still today: no lazy close, the agent can write
- ✅ 00:00 ART (03:00 UTC) is the next day: the past day closes
- ✅ an agent PUT for a past date that never existed → day_closed
- ✅ history: day summaries with completion, closing past days on the way

### tests/api/auth.test.ts — first-run setup

- ✅ requires SETUP_CODE, returns 10 single-use recovery codes, then 404 forever

### tests/api/auth.test.ts — who can call what

- ✅ agent (Bearer), user (cookie), none

### tests/api/auth.test.ts — PIN

- ✅ 5 wrong PINs lock the device for 15 min; the next lockout doubles; success resets
- ✅ a new device logs in with the PIN and appears in Dispositivos; rename and revoke
- ✅ re-auth after 7 days unused; sliding expiry; 90 days → unknown device
- ✅ change PIN; logout

### tests/api/auth.test.ts — forgot PIN

- ✅ recovery code: consumed once, shows remaining count
- ✅ regenerating recovery codes invalidates the old ones
- ✅ CLI reset code (pnpm auth:reset-pin): valid 15 min, single use

### tests/api/auth.test.ts — fingerprint

- ✅ registration options are platform + user verification required; bad verify → 401

### tests/api/webhook.test.ts — webhook to Agenbot

- ✅ choose is sent immediately; my later changes are debounced 120 s into one batch
- ✅ the agent's own changes never trigger the webhook (no loops)
- ✅ retries with exponential backoff, 5 attempts, then failed; never blocks my request
- ✅ webhook status in Ajustes

### tests/api/webhook.test.ts — reminders

- ✅ 10 min before a pending call with remind on, once; respects the device toggle
- ✅ sleep reminder at 10:00 only when last night is incomplete, once

### tests/api/tracking.test.ts — habits

- ✅ create, list with period progress; slug is unique; addressable by slug
- ✅ marking the gym block done logs the habit (D29); undo removes it
- ✅ logs: upsert by date; the agent can't overwrite mine; numeric values

### tests/api/tracking.test.ts — tasks

- ✅ agent checklist from the PUT; I tick one; the agent can't edit mine

### tests/api/tracking.test.ts — sleep

- ✅ Me voy a dormir at 00:20 belongs to the previous night and marks the sleep block done
- ✅ manual load; validation; the agent fills only empty halves

### tests/api/metrics.test.ts — agent context (Saturday 17, 08:00)

- ✅ weekly gym, pending habits, streaks at risk, yesterday, last review, skipped patterns

### tests/api/metrics.test.ts — metrics (week of the 12th, seen on Monday 19)

- ✅ blocks, calls, gym, reading, sleep and habit streaks
- ✅ month and year ranges

### tests/api/platform.test.ts — platform

- ✅ every operation in the contract is implemented
- ✅ agent rate limit: 120 req/min → 429 with Retry-After
- ✅ unknown routes → 404, wrong method → 405 (problem+json)
- ✅ health checks the DB; openapi.json is compact by default
- ✅ push subscribe is an upsert by endpoint; unsubscribe
- ✅ export has everything except auth secrets
- ✅ changelog: every write is logged with actor and requestId; cursor pagination
- ✅ invalid JSON and bad If-Match → 400

### tests/api/days.test.ts — 07:00 load and choose

- ✅ creates a draft day with both options, calendar + agent blocks and the checklist
- ✅ the agent's GET and my GET return the same day; anonymous gets 401
- ✅ returns 404 day_not_found before the agent loads it
- ✅ I choose option A → chosen

### tests/unit/domain.test.ts — planMerge

- ✅ matches calendar blocks by externalId and moves them
- ✅ matches agent blocks by id and preserves my overridden fields
- ✅ never touches tracking fields; locked blocks keep their schedule
- ✅ keeps a tracked calendar block that disappeared (removedFromCalendarAt), deletes untouched ones
- ✅ clears removedFromCalendarAt when the event comes back
- ✅ agent blocks without a known id fall back to type + title (no duplicates on re-send)
- ✅ never deletes my own blocks or locked blocks

### tests/unit/domain.test.ts — planBlockPatch (ownership)

- ✅ calendar schedule fields are owned by Google for me
- ✅ my schedule edit joins userOverrides; tracking sets statusAt
- ✅ agent vs my overrides → conflict, unless force (which drops the override)
- ✅ locked blocks reject the agent even with force
- ✅ agent sets tracking only while unset / pending
- ✅ same value is a no-op, not a conflict
- ✅ outcome only on calls

### tests/unit/domain.test.ts — streaks

- ✅ weekly: counts met weeks back from the current one; the running week doesn't break it
- ✅ daily numeric: needs value ≥ target; a missed past day breaks

### tests/unit/domain.test.ts — ART time (UTC-3) and midnight edges

- ✅ 23:59 ART is still the same local day; 00:00 ART is the next one
- ✅ formats with -03:00 and maps block times past midnight
- ✅ sleep night: before 12:00 belongs to the previous day
- ✅ weeks start on Monday; month ends

## Agenbot simulation

`scripts/agent-simulation.sh` (curl) against `pnpm dev` (usage in the script header):

```
1. Health                 ✓ GET  /api/health → 200
2. Contract               ✓ GET  /api/openapi.json → 200 (compact, 42 paths)
3. Planning context       ✓ GET  /api/agent/context?date=… → 200
4. 07:00 load             ✓ PUT  /api/days/… → 201 created · draft · A:12 B:13 · 4 tasks
5. Retry same key         ✓ PUT  /api/days/… → 201 · Idempotent-Replayed: true · identical response
6. Read back              ✓ GET  /api/days/… → 200 · version 1 · ETag "1"
7. "elegí la A"           ✓ POST /api/days/…/choose → 200 chosen
8. Calendar change        ✓ PATCH /api/days/…/blocks/by-external/… → 200 · 2 copies → 15:00
9. "ya fui al gym"        ✓ PATCH /api/days/…/blocks/{gym} → 200 done
10. Re-plan               ✓ PUT  /api/days/… → 202 proposed · diff: Lectura (30 min) 11:00→14:00
11. My changes            ✓ GET  /api/changelog?actor=user → 200
12. Weekly metrics        ✓ GET  /api/metrics?range=week → 200
✓ 12 requests OK
```

