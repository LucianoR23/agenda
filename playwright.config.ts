import { defineConfig } from "@playwright/test";
import { assertTestDatabase } from "./src/server/db/guard";

export const E2E = {
  port: 3200,
  db: assertTestDatabase(process.env.E2E_DATABASE_URL ?? "postgres://agenda:agenda@localhost:5433/agenda_e2e_test"),
  setupCode: "e2e-setup",
  pin: "482913",
};

/** Server env for the production build under test (overrides .env). */
export const serverEnv = {
  DATABASE_URL: E2E.db,
  APP_ORIGIN: `http://localhost:${E2E.port}`,
  WEBAUTHN_RP_ID: "localhost",
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
  SETUP_CODE: E2E.setupCode,
  APP_VERSION: "e2e",
  DISABLE_WORKER: "1",
  PORT: String(E2E.port),
  HOSTNAME: "127.0.0.1",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${E2E.port}`,
    viewport: { width: 412, height: 915 }, // Galaxy S26 Ultra CSS viewport
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-AR",
    timezoneId: "America/Buenos_Aires",
    colorScheme: "dark",
    userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  },
  webServer: {
    command: "pnpm exec tsx tests/e2e/prepare-db.ts && pnpm build && node scripts/e2e-server.mjs",
    url: `http://localhost:${E2E.port}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: serverEnv,
  },
});
