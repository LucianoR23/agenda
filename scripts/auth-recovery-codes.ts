/** `pnpm auth:recovery-codes` — regenerates the 10 recovery codes (the old ones stop working). */
import "dotenv/config";
import { newRecoveryCodes } from "../src/server/auth/auth";
import { closeDb, getDb } from "../src/server/db/client";
import { appUser } from "../src/server/db/schema";

async function main() {
  const [user] = await getDb().select({ id: appUser.id }).from(appUser).limit(1);
  if (!user) throw new Error("No user yet: finish the first-run setup in the app.");
  const codes = await newRecoveryCodes(getDb());
  console.log("New recovery codes (each works once; store them somewhere safe):\n");
  for (const c of codes) console.log(`  ${c}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
