import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/server/http/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
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
