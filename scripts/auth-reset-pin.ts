/**
 * `pnpm auth:reset-pin` — run from the Coolify container terminal when the PIN is forgotten and no recovery
 * code is at hand. Prints a one-time code valid 15 min; enter it in "Olvidé mi PIN" → "Código del servidor".
 */
import "dotenv/config";
import { createResetCode } from "../src/server/auth/auth";
import { resetCode } from "../src/server/auth/crypto";
import { closeDb, getDb } from "../src/server/db/client";
import { appUser } from "../src/server/db/schema";

async function main() {
  const [user] = await getDb().select({ id: appUser.id }).from(appUser).limit(1);
  if (!user) throw new Error("No user yet: finish the first-run setup in the app.");
  const code = resetCode();
  await createResetCode(getDb(), code, new Date());
  console.log(`PIN reset code (valid 15 minutes, single use):\n\n  ${code}\n`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
