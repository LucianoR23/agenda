import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/contract/**"],
      exclude: ["src/contract/examples.ts", "src/contract/routes/**", "src/server/worker.ts"],
      reporter: ["text-summary", "text"],
    },
    projects: [
      {
        // pure logic, no database: runs anywhere (`pnpm test:unit`)
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], setupFiles: ["tests/helpers/env.ts"] },
      },
      {
        // router + Postgres: a freshly migrated agenda_test (refused unless the name ends in _test)
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/db/**/*.test.ts", "tests/api/**/*.test.ts"],
          globalSetup: ["tests/helpers/global-setup.ts"],
          setupFiles: ["tests/helpers/env.ts"],
          // one shared test database: files run one after another
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
