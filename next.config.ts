import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // React Compiler (Babel plugin, stable). The Rust port (experimental.turbopackRustReactCompiler) is still experimental.
  reactCompiler: true,
  cacheComponents: true,
  partialPrefetching: true,
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
