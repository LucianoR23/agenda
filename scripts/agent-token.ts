/**
 * `pnpm agent:token` — new Agenbot token. Give the token to Agenbot; put only the hash in AGENT_TOKEN_HASH.
 * Rotating: set the new hash in Coolify, redeploy, update Agenbot. The old token stops working immediately.
 */
import { createHash, randomBytes } from "node:crypto";

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");

console.log(`Agent token (give to Agenbot, shown once):\n  ${token}\n`);
console.log(`AGENT_TOKEN_HASH (env var):\n  ${hash}`);
