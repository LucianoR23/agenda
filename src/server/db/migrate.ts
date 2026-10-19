import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Applies pending SQL migrations from ./drizzle. Idempotent; safe to run on every container start. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pg = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(pg), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "./drizzle" });
  await pg.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
