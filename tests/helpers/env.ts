import { assertTestDatabase } from "@/server/db/guard";

export const SETUP_CODE = "setup-code-for-tests";

/** The only database tests may use; refused unless its name ends in _test. */
export const TEST_DATABASE_URL = assertTestDatabase(process.env.TEST_DATABASE_URL ?? "postgres://agenda:agenda@localhost:5433/agenda_test");

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  APP_ORIGIN: "https://agenda.lemydev.com",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  SETUP_CODE,
  WEBAUTHN_RP_ID: "agenda.lemydev.com",
  PIN_REAUTH_DAYS: "7",
  DEVICE_TRUST_DAYS: "90",
  ARGON2_MEMORY_KIB: "1024",
  APP_VERSION: "test",
});
