import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // API tests (tests/api) need the schema; they come back in phase 2 with migration 0000 and the
    // `_test` database guard (phase 1). Until then only DB-free unit tests run.
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/helpers/env.ts"],
    // one shared test database: run files one after another
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/contract/**"],
      exclude: ["src/contract/examples.ts", "src/contract/routes/**", "src/server/worker.ts"],
      reporter: ["text-summary", "text"],
    },
    hookTimeout: 60_000,
  },
});
