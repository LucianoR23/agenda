// Bundles the maintenance CLIs into plain ESM for the production image (no tsx / TypeScript at runtime).
import { build } from "esbuild";

const entries = {
  migrate: "src/server/db/migrate.ts",
  "auth-reset-pin": "scripts/auth-reset-pin.ts",
  "auth-recovery-codes": "scripts/auth-recovery-codes.ts",
  "agent-token": "scripts/agent-token.ts",
};

await build({
  entryPoints: entries,
  outdir: "dist-cli",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // native addon: resolved from the image's node_modules
  external: ["@node-rs/argon2"],
  alias: { "@": "./src" },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
console.log(`✓ dist-cli: ${Object.keys(entries).join(", ")}`);
