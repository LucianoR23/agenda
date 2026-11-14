import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/sw.js/route";

describe("service worker script", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is valid JavaScript, versioned by APP_VERSION and never cached as a file", async () => {
    vi.stubEnv("APP_VERSION", "abc123");
    const res = GET();
    const source = await res.text();
    expect(() => new Function(source)).not.toThrow(); // parses
    expect(source).toContain('const VERSION = "agenda-abc123";');
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toMatch(/javascript/);
  });

  it("deletes every other cache on activate (v1's agenda-v2 included) and never caches /api", async () => {
    const source = await GET().text();
    expect(source).toContain('keys.filter((k) => !k.startsWith(VERSION + "-"))');
    expect(source).toContain('url.pathname.startsWith("/api/")');
  });

  it("sanitizes the version it embeds", async () => {
    vi.stubEnv("APP_VERSION", '1.0"; alert(1); //');
    const source = await GET().text();
    expect(source).toContain('const VERSION = "agenda-1.0alert1";');
  });
});
