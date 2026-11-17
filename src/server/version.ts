/**
 * The version stamped at build by next.config.ts: `<package.json version>+<short commit>` when the build gets
 * SOURCE_COMMIT (Coolify's "Include Source Commit in Build", CI), else `<version>+build-<timestamp>`. Outside a Next
 * build (CLIs, tests) it's `dev`. APP_VERSION, when the deploy sets one, wins over it (src/server/env.ts).
 */
export function buildVersion(): string {
  // a literal `process.env.X` so Next inlines it at build
  return process.env.BUILD_VERSION || "dev";
}
