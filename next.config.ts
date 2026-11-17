import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/server/http/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // inlined at build: a per-build stamp, so the service worker changes on every deploy even when the platform
  // doesn't pass APP_VERSION (src/app/sw.js/route.ts)
  env: {
    BUILD_STAMP: new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14),
  },
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
