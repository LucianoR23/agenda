import Dexie, { type EntityTable } from "dexie";
import type { Adjustment } from "./types";

/** Last good server response per query key (offline reads). */
export interface CacheEntry {
  key: string;
  data: unknown;
  at: number;
}

/** A write waiting to reach the server (optimistic, replayed on reconnect with its Idempotency-Key). */
export interface OutboxItem {
  id: string; // uuidv7, also the Idempotency-Key
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Query keys to refresh once it lands. */
  invalidate: string[];
  /** How to re-apply the optimistic change on top of fresh server data. */
  optimistic?: Optimistic;
  label: string;
  createdAt: number;
  state: "pending" | "conflict";
  conflict?: { code?: string; detail?: string; current?: unknown };
}

export type Optimistic =
  | { kind: "block"; date: string; blockId: string; patch: Record<string, unknown> }
  | { kind: "task"; date: string; taskId: string; patch: Record<string, unknown> }
  | { kind: "adjustment"; date: string; adjustment: Adjustment };

class AgendaDb extends Dexie {
  cache!: EntityTable<CacheEntry, "key">;
  outbox!: EntityTable<OutboxItem, "id">;
  constructor() {
    super("agenda");
    this.version(1).stores({ cache: "key, at", outbox: "id, createdAt, state" });
  }
}

let instance: AgendaDb | null = null;
/** IndexedDB, lazily (never on the server). */
export const idb = () => (instance ??= new AgendaDb());
