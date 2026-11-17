import { afterEach, describe, expect, it, vi } from "vitest";
import { log, REDACTED, redact } from "@/server/log";

describe("logger redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("redacts secret keys at any depth, keeps the rest", () => {
    const out = redact({
      requestId: "req_1",
      headers: { authorization: "Bearer abc.def", cookie: "agenda_session=xyz", "user-agent": "Chrome" },
      body: { pin: "482913", newPin: "111111", setupCode: "s", token: "t", nested: { refreshToken: "r", ok: 1 } },
      push: { keys: { p256dh: "k", auth: "a" } },
    }) as Record<string, any>;
    expect(out.requestId).toBe("req_1");
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers.cookie).toBe(REDACTED);
    expect(out.headers["user-agent"]).toBe("Chrome");
    expect(out.body.pin).toBe(REDACTED);
    expect(out.body.setupCode).toBe(REDACTED);
    expect(out.body.token).toBe(REDACTED);
    expect(out.body.nested).toEqual({ refreshToken: REDACTED, ok: 1 });
    expect(out.push.keys).toEqual({ p256dh: REDACTED, auth: REDACTED });
  });

  it("scrubs secrets inside strings and errors", () => {
    const err = new Error("connect failed postgres://agenda:s3cret@db:5432/agenda with Bearer tok_123");
    const out = redact({ err }) as { err: { message: string; stack: string } };
    expect(out.err.message).not.toContain("s3cret");
    expect(out.err.message).not.toContain("tok_123");
    expect(out.err.stack).not.toContain("s3cret");
  });

  it("survives cycles and writes one JSON line per entry", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect((redact(a) as Record<string, unknown>).self).toBe("[Circular]");
    vi.stubEnv("LOG_LEVEL", "info");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    log.info("hello", { cookie: "agenda_session=abc", n: 1 });
    const line = String(write.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: "info", msg: "hello", cookie: REDACTED, n: 1 });
    expect(line).not.toContain("abc");
  });
});
