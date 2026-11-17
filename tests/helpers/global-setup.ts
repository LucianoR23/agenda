import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { assertTestDatabase } from "../../src/server/db/guard";

/** Fresh schema on the test database, then migrations. */
export default async function setup() {
  // checked before the DROP SCHEMA below: never anything but a *_test database
  const url = assertTestDatabase(process.env.TEST_DATABASE_URL ?? "postgres://agenda:agenda@localhost:5433/agenda_test");
  const pg = postgres(url, { max: 1, onnotice: () => {} });
  await pg.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  await pg.end();
}
