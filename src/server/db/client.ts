import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

function create(url: string) {
  const pg = postgres(url, { max: 10, onnotice: () => {} });
  return { pg, db: drizzle(pg, { schema, casing: "snake_case" }) };
}

type Conn = ReturnType<typeof create>;

// one pool per process, reused across dev hot reloads
const globalForDb = globalThis as unknown as { agendaDb?: Conn | undefined };

function conn(): Conn {
  if (!globalForDb.agendaDb) {
    globalForDb.agendaDb = create(env().DATABASE_URL);
  }
  return globalForDb.agendaDb;
}

export type Db = Conn["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or a transaction. */
export type DbLike = Db | Tx;

export const getDb = (): Db => conn().db;

/** Tests / scripts: close the pool. */
export async function closeDb() {
  if (globalForDb.agendaDb) {
    await globalForDb.agendaDb.pg.end();
    globalForDb.agendaDb = undefined;
  }
}
