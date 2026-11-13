import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const base = {
  DATABASE_URL: "postgres://agenda:agenda@localhost:5433/agenda_dev",
  SESSION_SECRET: "x".repeat(32),
  SETUP_CODE: "setup-code",
};

describe("env", () => {
  it("applies defaults and parses flags and lists", () => {
    const e = parseEnv({ ...base, TRUST_CF: "true", CORS_ALLOWED_ORIGINS: "https://sunday.lemydev.com, https://a.example" });
    expect(e.TRUST_CF).toBe(true);
    expect(e.DISABLE_WORKER).toBe(false);
    expect(e.CORS_ALLOWED_ORIGINS).toEqual(["https://sunday.lemydev.com", "https://a.example"]);
    expect(e.LOG_LEVEL).toBe("info");
    expect(e.PIN_REAUTH_DAYS).toBe(7);
  });

  it("treats empty values as unset", () => {
    const e = parseEnv({ ...base, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "", ENCRYPTION_KEY: " " });
    expect(e.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(e.ENCRYPTION_KEY).toBeUndefined();
  });

  it("reports problems by name without echoing secret values", () => {
    const secret = "postgres://agenda:hunter2-very-secret@db/agenda";
    let message = "";
    try {
      parseEnv({
        ...base,
        DATABASE_URL: "mysql://agenda:hunter2-very-secret@db/agenda",
        SESSION_SECRET: "short",
        VAPID_PUBLIC_KEY: "only-one",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).toMatch(/VAPID/);
    expect(message).not.toMatch(/hunter2/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("short");
  });

  it("requires https in production and an encryption key with Google", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", APP_ORIGIN: "http://agenda.lemydev.com" })).toThrow(/APP_ORIGIN/);
    expect(() => parseEnv({ ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" })).toThrow(/ENCRYPTION_KEY/);
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: "dG9vLXNob3J0" })).toThrow(/32 bytes/);
  });
});
