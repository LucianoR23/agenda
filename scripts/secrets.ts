/**
 * Prints fresh production secrets for the first deploy (docs/v2/runbooks/deploy.md §5).
 *   pnpm secrets:gen
 * Run it on your own machine and paste each value straight into Coolify (marked as secret). Nothing is written to
 * disk; don't save the output or paste it anywhere else. Re-running gives new values: only use one set.
 */
import { randomBytes } from "node:crypto";
import { generateVAPIDKeys } from "web-push";

const vapid = generateVAPIDKeys();
// URL-safe, so it can go straight into DATABASE_URL
const dbPassword = randomBytes(24).toString("base64url");

const lines = [
  "# Database role password (step 3: CREATE ROLE … and inside DATABASE_URL)",
  `AGENDA_DB_PASSWORD=${dbPassword}`,
  "",
  "# Coolify → agenda → Environment Variables (each one: Is Secret = on)",
  `SESSION_SECRET=${randomBytes(32).toString("base64")}`,
  `SETUP_CODE=${randomBytes(6).toString("hex")}`,
  `ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
];

console.log(lines.join("\n"));
