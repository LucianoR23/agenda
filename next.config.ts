import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/server/http/security-headers";

/**
 * `<package.json version>+<short commit>`, or `+build-<timestamp>` when the build doesn't get SOURCE_COMMIT. Every
 * deploy gets a new value, so the service worker updates even when the platform doesn't set APP_VERSION.
 */
function buildVersion(): string {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const commit = (process.env.SOURCE_COMMIT ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(commit)) return `${version}+${commit.slice(0, 7)}`;
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `${version}+build-${stamp}`;
}

const nextConfig: NextConfig = {
  output: "standalone",
  // inlined at build (src/server/version.ts)
  env: { BUILD_VERSION: buildVersion() },
  // React Compiler (Babel plugin, stable). The Rust port (experimental.turbopackRustReactCompiler) is still experimental.
  reactCompiler: true,
  // cacheComponents / partialPrefetching are off: the per-request CSP nonce needs dynamic rendering and is
  // incompatible with PPR (Next docs, "Content Security Policy"). Screens render on the client behind the auth gate.
  async headers() {
    return [{ source: "/:path*", headers: STATIC_SECURITY_HEADERS }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
