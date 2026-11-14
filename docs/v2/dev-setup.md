# Dev setup — pick up agenda v2 on another machine

Everything needed to clone, run and keep working on **v2** (branch `v2`). Windows + Git Bash is the reference
environment; macOS/Linux work the same with their own installers.

## 1. Install

| Tool | Version | Notes |
|---|---|---|
| **Git** | any recent | Git Bash is the shell the scripts and docs assume on Windows. Set `core.autocrlf=true` or leave it; the repo forces LF (`.gitattributes`). |
| **Node.js** | **26.x** (LTS) | Native `Temporal` is required (server time code uses it). On Windows: [nvm-windows](https://github.com/coreybutler/nvm-windows) → `nvm install 26 && nvm use 26`. `package.json` has `"engines": { "node": ">=26" }`. |
| **pnpm** | **11.17.0** (pinned in `packageManager`) | Node 25+ no longer ships corepack: `npm install -g pnpm@11.17.0`. |
| **Docker Desktop** | recent, WSL 2 backend | Runs the local Postgres 18 (`pgvector/pgvector:pg18-trixie`, same image as production). |
| **VS Code** (optional) | — | Install the **Biome** extension (formatter + linter; ESLint is gone). |

Check:

```bash
node -v        # v26.x
pnpm -v        # 11.17.0
docker info --format '{{.ServerVersion}}'
node -p "typeof Temporal"   # object
```

## 2. Clone and install

```bash
git clone https://github.com/LucianoR23/agenda.git
cd agenda
git switch v2
pnpm install
```

## 3. Environment

```bash
cp .env.example .env
```

Fill at least these (never commit `.env`; never paste secrets into chats or logs):

| Variable | Local value |
|---|---|
| `DATABASE_URL` | `postgres://agenda:agenda@localhost:5433/agenda_dev` (already in the example) |
| `TEST_DATABASE_URL` | `postgres://agenda:agenda@localhost:5433/agenda_test` (tests refuse any DB not ending in `_test`) |
| `APP_ORIGIN` | `http://localhost:3000` |
| `WEBAUTHN_RP_ID` | `localhost` |
| `SESSION_SECRET` | `openssl rand -base64 32` (32+ chars) |
| `SETUP_CODE` | any string of 8+ chars; you type it once on the first-run screen |

Everything else can stay empty locally (VAPID, Google, ENCRYPTION_KEY are for later phases). The server validates the
environment at boot and exits naming the variable that is wrong (never its value).

## 4. Database

```bash
pnpm db:up        # Postgres on 127.0.0.1:5433 with agenda_dev, agenda_test, agenda_e2e_test
pnpm db:migrate   # applies drizzle/0000_init.sql + 0001_db_logic.sql to agenda_dev
```

The init script that creates the three databases only runs when the Docker volume is new. If you reuse an old volume
from v1, recreate it: `docker compose down -v && pnpm db:up` (this deletes local data only).

## 5. Run and check

```bash
pnpm dev          # http://localhost:3000 → first-run setup with your SETUP_CODE, then a 6-digit PIN
```

The gate every phase must pass (same as CI):

```bash
pnpm typecheck && pnpm check && pnpm test && pnpm build
```

| Command | What it does |
|---|---|
| `pnpm test:unit` | Pure logic only, no database needed |
| `pnpm test` | Unit + integration (router + Postgres `agenda_test`, migrated fresh each run; responses checked against `openapi.yaml`) |
| `pnpm test:e2e` | Playwright on the production standalone build (Android viewport, `agenda_e2e_test`); first run: `pnpm exec playwright install chromium`. Screenshots land in `test-results/screens/` |
| `pnpm check` / `pnpm fix` | Biome lint + format (check / apply) |
| `pnpm openapi:gen` / `openapi:check` / `openapi:lint` | Regenerate `openapi.yaml` from `src/contract` / drift check / Redocly |
| `pnpm db:generate --name x` | New migration from the Drizzle schema. `0000` is pure drizzle-kit output; hand-written SQL goes in custom migrations (`--custom`) |
| `pnpm db:check` | Schema ↔ migrations consistency |
| `pnpm icons` | Rebuild `public/icons.svg` after adding a name to `src/ui/icons.ts` |
| `pnpm audit` | Dependency advisories (CI fails on any) |

## 6. Where the work is

- **Branch:** `v2` (v1 is the tag `v1`; never push to `main`, never force-push).
- **Status:** phases 0–4 done except the first deploy (tooling, schema, auth & security, API tokens, settings, CSP,
  tasks API + Hoy/Inbox/Tareas screens). See [`08-roadmap-and-cutover.md`](08-roadmap-and-cutover.md) for the checklist
  and the decisions recorded per phase.
- **Blocked:** the first deploy waits for the `agenda` database on postgres-core; follow
  [`runbooks/deploy.md`](runbooks/deploy.md) when it exists.
- **Next:** phase 5 (reminders and push) — starts with a plan for approval.
- **Working agreement:** read [`CLAUDE.md`](../../CLAUDE.md) first (plan → approval → implement → gate → tick → summary).

## Troubleshooting

- **Docker returns 500 / commands hang** (`dockerDesktopLinuxEngine`): quit Docker Desktop completely and reopen it;
  if it persists, reboot. `docker info` answering is not enough; try `docker compose up -d --wait`.
- **`corepack: not found`**: expected on Node 26; install pnpm with npm (see table above).
- **Tests say "Refusing to run tests against database …"**: `TEST_DATABASE_URL` must point to a database whose name
  ends in `_test`. This guard is intentional.
- **Production build locally** (`node .next/standalone/server.js`): copy `.next/static` to `.next/standalone/.next/`
  and `public/` to `.next/standalone/` first (the Dockerfile does it), and use an `https://` `APP_ORIGIN`
  (production requires it).
- **Blank page with CSP errors in dev**: the CSP allows `'unsafe-eval'` and `ws:` only in development; make sure you run
  `pnpm dev`, not a production build, for local UI work.
