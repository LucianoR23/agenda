import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { E2E } from "../../playwright.config";

/** Fresh e2e database next to the vitest one (runs before the server starts, see playwright.config.ts). */
async function setup() {
  const admin = postgres(E2E.db.replace(/\/agenda_e2e$/, "/agenda_test"), { max: 1, onnotice: () => {} });
  const [exists] = await admin`select 1 from pg_database where datname = 'agenda_e2e'`;
  if (!exists) await admin.unsafe("CREATE DATABASE agenda_e2e");
  await admin.end();
  const pg = postgres(E2E.db, { max: 1, onnotice: () => {} });
  await pg.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  await pg.end();
}

setup().catch((e) => {
  console.error(e);
  process.exit(1);
});
