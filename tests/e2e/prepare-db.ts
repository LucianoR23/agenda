import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { E2E } from "../../playwright.config";
import { assertTestDatabase, databaseName } from "../../src/server/db/guard";

/** Fresh e2e database next to the vitest one (runs before the server starts, see playwright.config.ts). */
async function setup() {
  const url = assertTestDatabase(E2E.db);
  const name = databaseName(url);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/agenda_test";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();
  const pg = postgres(url, { max: 1, onnotice: () => {} });
  await pg.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  await pg.end();
}

setup().catch((e) => {
  console.error(e);
  process.exit(1);
});
