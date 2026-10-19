import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// reuse the connection across dev hot reloads
const globalForDb = globalThis as unknown as { pg?: postgres.Sql };
const pg = globalForDb.pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema, casing: "snake_case" });
export type Db = typeof db;
