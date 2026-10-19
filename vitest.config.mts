import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
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
