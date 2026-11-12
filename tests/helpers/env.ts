export const SETUP_CODE = "setup-code-for-tests";

Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://agenda:agenda@localhost:5434/agenda_test",
  APP_ORIGIN: "https://agenda.lemydev.com",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  SETUP_CODE,
  WEBAUTHN_RP_ID: "agenda.lemydev.com",
  PIN_REAUTH_DAYS: "7",
  DEVICE_TRUST_DAYS: "90",
  ARGON2_MEMORY_KIB: "1024",
  APP_VERSION: "test",
});
