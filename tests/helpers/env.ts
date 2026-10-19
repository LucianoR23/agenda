import { createHash } from "node:crypto";

export const AGENT_TOKEN = "test-agent-token-0123456789abcdef";
export const INTERNAL_TOKEN = "test-internal-token-0123456789";
export const SETUP_CODE = "setup-code-for-tests";

Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://agenda:agenda@localhost:5434/agenda_test",
  APP_ORIGIN: "https://agenda.lemydev.com",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  SETUP_CODE,
  AGENT_TOKEN_HASH: createHash("sha256").update(AGENT_TOKEN).digest("hex"),
  INTERNAL_TOKEN,
  WEBAUTHN_RP_ID: "agenda.lemydev.com",
  AGENT_WEBHOOK_URL: "https://agenbot.test/webhooks/agenda",
  AGENT_WEBHOOK_TOKEN: "webhook-token",
  WEBHOOK_DEBOUNCE_SECONDS: "120",
  PIN_REAUTH_DAYS: "7",
  DEVICE_TRUST_DAYS: "90",
  SLEEP_REMINDER_TIME: "10:00",
  ARGON2_MEMORY_KIB: "1024",
  APP_VERSION: "test",
});
