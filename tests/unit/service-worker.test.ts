import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/sw.js/route";
import { resetEnv } from "@/server/env";

function stub(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  resetEnv();
}

describe("service worker script", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnv();
  });

  it("is valid JavaScript, versioned by APP_VERSION and never cached as a file", async () => {
    stub({ APP_VERSION: "abc123" });
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

  it("without APP_VERSION it uses the build version (new on every build)", async () => {
    stub({ APP_VERSION: "", BUILD_VERSION: "2.0.0+a9c942f" });
    expect(await GET().text()).toContain('const VERSION = "agenda-2.0.0+a9c942f";');
  });

  it("sanitizes the version it embeds", async () => {
    stub({ APP_VERSION: '1.0"; alert(1); //' });
    const source = await GET().text();
    expect(source).toContain('const VERSION = "agenda-1.0alert1";');
  });
});
