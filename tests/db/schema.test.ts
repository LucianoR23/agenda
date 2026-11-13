import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { one } from "@/server/db/one";
import { event, habit, habitLog, reminder, reminderDelivery, sleepLog, task, taskList } from "@/server/db/schema";
import { resetDb } from "../helpers/api";

const db = () => getDb();

/** The Postgres error behind a failed drizzle query (constraint name and SQLSTATE). */
async function pgError(p: Promise<unknown>): Promise<{ code: string | undefined; constraint: string | undefined }> {
  try {
    await p;
  } catch (e) {
    const cause =
      (e as { cause?: { code?: string; constraint_name?: string } }).cause ?? (e as { code?: string; constraint_name?: string });
    return { code: cause.code, constraint: cause.constraint_name };
  }
  throw new Error("expected the query to fail");
}

const inbox = async () => {
  const [row] = await db().select().from(taskList).where(eq(taskList.isInbox, true));
  if (!row) throw new Error("no inbox");
  return row;
};

const newTask = async (values: Partial<typeof task.$inferInsert> = {}) => {
  const [row] = await db()
    .insert(task)
    .values({ listId: (await inbox()).id, title: "Llamar al contador", source: "user", updatedBy: "user", ...values })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
};

beforeEach(() => resetDb());
afterAll(() => closeDb());

describe("migrations", () => {
  it("ids default to UUIDv7 (time-ordered)", async () => {
    const a = await newTask();
    const b = await newTask({ title: "Pagar la luz" });
    expect(a.id[14]).toBe("7");
    expect(a.id < b.id).toBe(true);
  });

  it("installs the search extensions and the trigger functions", async () => {
    const ext = await db().execute<{ extname: string }>(sql`select extname from pg_extension`);
    expect(ext.map((e) => e.extname)).toEqual(expect.arrayContaining(["pg_trgm", "unaccent"]));
    const fns = await db().execute<{ proname: string }>(
      sql`select proname from pg_proc where proname in ('bump_row_version', 'touch_updated_at', 'f_unaccent', 'f_search')`,
    );
    expect(fns).toHaveLength(4);
  });
});

describe("versioning triggers", () => {
  it("every update bumps version and updated_at, whatever the app sends", async () => {
    const t = await newTask();
    expect(t.version).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    const u = one(
      await db().update(task).set({ title: "Llamar al contador (urgente)", version: 99 }).where(eq(task.id, t.id)).returning(),
      "u",
    );
    expect(u?.version).toBe(2);
    expect(u.updatedAt.getTime()).toBeGreaterThan(t.updatedAt.getTime());
    expect(u.createdAt.getTime()).toBe(t.createdAt.getTime());
  });

  it("optimistic concurrency: an update against a stale version touches nothing", async () => {
    const t = await newTask();
    await db().update(task).set({ priority: 1 }).where(eq(task.id, t.id));
    const stale = await db().update(task).set({ priority: 3 }).where(sql`${task.id} = ${t.id} AND ${task.version} = 1`).returning();
    expect(stale).toHaveLength(0);
  });
});

describe("Inbox", () => {
  it("is seeded, unique and can't be deleted", async () => {
    const box = await inbox();
    expect(box.name).toBe("Inbox");
    expect((await pgError(db().insert(taskList).values({ name: "Otra inbox", isInbox: true, updatedBy: "user" }))).constraint).toBe(
      "task_list_one_inbox_uq",
    );
    expect((await pgError(db().update(taskList).set({ deletedAt: new Date() }).where(eq(taskList.id, box.id)))).constraint).toBe(
      "task_list_inbox_not_deleted",
    );
  });

  it("list names are unique (case-insensitive) among live lists", async () => {
    await db().insert(taskList).values({ name: "Trabajo", updatedBy: "user" });
    expect((await pgError(db().insert(taskList).values({ name: "trabajo", updatedBy: "user" }))).constraint).toBe(
      "task_list_active_name_uq",
    );
  });
});

describe("task constraints", () => {
  it.each([
    [{ dueTime: "09:00" }, "task_time_needs_date"],
    [{ rrule: "FREQ=WEEKLY" }, "task_rrule_needs_date"],
    [{ priority: 4 }, "task_priority_range"],
    [{ status: "done" as const }, "task_completed_consistent"],
    [{ title: "" }, "task_title_length"],
  ])("%o → %s", async (values, constraint) => {
    expect((await pgError(newTask(values))).constraint).toBe(constraint);
  });

  it("a done task carries completed_at; client_id is unique", async () => {
    await newTask({ status: "done", completedAt: new Date(), dueDate: "2026-11-13", dueTime: "09:00" });
    await newTask({ clientId: "sunday-123" });
    expect((await pgError(newTask({ clientId: "sunday-123" }))).constraint).toBe("task_client_id_uq");
  });

  it("a list with tasks can't be hard-deleted", async () => {
    const list = one(await db().insert(taskList).values({ name: "Casa", updatedBy: "user" }).returning(), "list");
    await newTask({ listId: list.id });
    expect((await pgError(db().delete(taskList).where(eq(taskList.id, list.id)))).code).toBe("23001"); // restrict_violation
  });
});

describe("search", () => {
  it("is accent- and case-insensitive over title and notes, and uses the trigram index", async () => {
    await newTask({ title: "Reunión con Martín", notes: "Llevar el presupuesto" });
    await newTask({ title: "Comprar pan" });
    const q = (text: string) =>
      db().execute<{ title: string }>(sql`select title from task where f_search(title, notes) like '%' || f_search(${text}) || '%'`);
    expect((await q("reunion")).map((r) => r.title)).toEqual(["Reunión con Martín"]);
    expect((await q("MARTIN")).map((r) => r.title)).toEqual(["Reunión con Martín"]);
    expect((await q("presupuesto")).map((r) => r.title)).toEqual(["Reunión con Martín"]);

    // with realistic volume (and stats) the planner picks the trigram index for substring search
    const listId = (await inbox()).id;
    await db().execute(
      sql`insert into task (list_id, title, source, updated_by)
          select ${listId}, 'Tarea número ' || g, 'user', 'user' from generate_series(1, 5000) g`,
    );
    await db().execute(sql`analyze task`);
    const plan = await db().execute<{ "QUERY PLAN": string }>(
      sql`explain select id from task where f_search(title, notes) like '%reunion%' and deleted_at is null`,
    );
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("task_search_trgm");
  });
});

describe("reminders", () => {
  const newReminder = async (values: Partial<typeof reminder.$inferInsert> = {}) => {
    return one(
      await db()
        .insert(reminder)
        .values({ title: "Tomar la pastilla", fireAt: new Date("2026-11-13T12:00:00Z"), source: "user", updatedBy: "user", ...values })
        .returning(),
      "reminder",
    );
  };

  it("a moment is delivered at most once", async () => {
    const r = await newReminder();
    const occurrenceAt = new Date("2026-11-13T12:00:00Z");
    const first = await db().insert(reminderDelivery).values({ reminderId: r.id, occurrenceAt }).onConflictDoNothing().returning();
    const second = await db().insert(reminderDelivery).values({ reminderId: r.id, occurrenceAt }).onConflictDoNothing().returning();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("event offsets materialize once per occurrence; offsets need an event", async () => {
    const ev = one(
      await db()
        .insert(event)
        .values({
          title: "Dentista",
          startsAt: new Date("2026-11-14T13:00:00Z"),
          timezone: "America/Buenos_Aires",
          reminderOffsets: [30],
          source: "user",
          updatedBy: "user",
        })
        .returning(),
      "ev",
    );
    const occ = { eventId: ev.id, offsetMinutes: 30, eventOccurrenceAt: new Date("2026-11-14T13:00:00Z") };
    await newReminder(occ);
    expect((await pgError(newReminder(occ))).constraint).toBe("reminder_event_offset_uq");
    expect((await pgError(newReminder({ offsetMinutes: 10 }))).constraint).toBe("reminder_offset_needs_event");
  });

  it("an action is recorded with its time", async () => {
    const r = await newReminder();
    expect(
      (await pgError(db().insert(reminderDelivery).values({ reminderId: r.id, occurrenceAt: new Date(), action: "done" }))).constraint,
    ).toBe("reminder_delivery_action_at");
  });
});

describe("events", () => {
  const base = { title: "Cumple de Ana", timezone: "America/Buenos_Aires", source: "user" as const, updatedBy: "user" as const };

  it("is timed or all-day, never both, and ends after it starts", async () => {
    await db()
      .insert(event)
      .values({ ...base, allDay: true, startDate: "2026-11-20", endDate: "2026-11-21" });
    await db()
      .insert(event)
      .values({ ...base, startsAt: new Date("2026-11-20T15:00:00Z"), endsAt: new Date("2026-11-20T16:00:00Z") });
    for (const bad of [
      { allDay: true, startDate: "2026-11-20", endDate: "2026-11-20" }, // end is exclusive: must be later
      { allDay: true, startDate: "2026-11-20", endDate: "2026-11-21", startsAt: new Date() },
      { startsAt: new Date("2026-11-20T15:00:00Z"), endsAt: new Date("2026-11-20T14:00:00Z") },
      { startDate: "2026-11-20" },
    ])
      expect(
        (
          await pgError(
            db()
              .insert(event)
              .values({ ...base, ...bad }),
          )
        ).constraint,
      ).toBe("event_timed_xor_all_day");
  });
});

describe("habits and sleep", () => {
  it("one live check-in per habit and day; a deleted one can be redone", async () => {
    const h = one(
      await db()
        .insert(habit)
        .values({ slug: "gym", name: "Gym", kind: "boolean", targetCount: 3, targetPeriod: "week", updatedBy: "user" })
        .returning(),
      "h",
    );
    const log = { habitId: h.id, date: "2026-11-13", done: true, source: "user" as const, updatedBy: "user" as const };
    const first = one(await db().insert(habitLog).values(log).returning(), "first");
    expect((await pgError(db().insert(habitLog).values(log))).constraint).toBe("habit_log_habit_date_uq");
    await db().update(habitLog).set({ deletedAt: new Date() }).where(eq(habitLog.id, first.id));
    await db().insert(habitLog).values(log);
  });

  it("sleep: quality 1–5, wake after bed and within 20 h", async () => {
    const base = { date: "2026-11-13", source: "user" as const, updatedBy: "user" as const };
    await db()
      .insert(sleepLog)
      .values({ ...base, bedAt: new Date("2026-11-13T02:30:00Z"), wakeAt: new Date("2026-11-13T10:10:00Z"), quality: 4 });
    const other = { ...base, date: "2026-11-14" };
    expect(
      (
        await pgError(
          db()
            .insert(sleepLog)
            .values({ ...other, quality: 6 }),
        )
      ).constraint,
    ).toBe("sleep_log_quality_range");
    expect(
      (
        await pgError(
          db()
            .insert(sleepLog)
            .values({ ...other, bedAt: new Date("2026-11-14T10:00:00Z"), wakeAt: new Date("2026-11-14T02:00:00Z") }),
        )
      ).constraint,
    ).toBe("sleep_log_order");
  });
});
