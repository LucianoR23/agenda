import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/http/ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("client IP", () => {
  it("uses the last X-Forwarded-For hop (Traefik's), never a client-supplied first hop", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), false)).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }), false)).toBe("203.0.113.9");
  });

  it("trusts CF-Connecting-IP only behind Cloudflare", () => {
    const headers = h({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "172.70.1.1" });
    expect(clientIp(headers, true)).toBe("198.51.100.4");
    expect(clientIp(headers, false)).toBe("172.70.1.1");
  });

  it("falls back to X-Real-IP and ignores garbage", () => {
    expect(clientIp(h({ "x-real-ip": "2001:db8::1" }), false)).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }), false)).toBeNull();
    expect(clientIp(h({}), true)).toBeNull();
  });
});
