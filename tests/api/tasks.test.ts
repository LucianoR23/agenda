import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { changeLog } from "@/server/db/schema";
import { client, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll("2026-11-16T08:00:00-03:00")); // Monday
afterAll(() => closeDb());

const newTask = async (user: Awaited<ReturnType<typeof setupUser>>["user"], body: Record<string, unknown>) => {
  const r = await user.post("/api/tasks", body);
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

describe("tasks", () => {
  it("without a list go to the Inbox; with a date and time get an instant in the user's zone", async () => {
    const { user } = await setupUser();
    const a = await newTask(user, { title: "Comprar pan" });
    const lists = (await user.get("/api/lists")).body.lists;
    expect(lists[0]).toMatchObject({ name: "Inbox", isInbox: true, openCount: 1 });
    expect(a.listId).toBe(lists[0].id);
    const b = await newTask(user, { title: "Llamar al contador", dueDate: "2026-11-17", dueTime: "09:00", priority: 2 });
    expect(b).toMatchObject({ dueAt: "2026-11-17T09:00:00.000-03:00", overdue: false, source: "user" });
    const rows = await getDb().select().from(changeLog).where(eq(changeLog.entityId, b.id));
    expect(rows[0]).toMatchObject({ action: "create", actor: "user" });
  });

  it("views: inbox, today, overdue, upcoming, done", async () => {
    const { user } = await setupUser();
    await newTask(user, { title: "Sin fecha" });
    await newTask(user, { title: "Hoy 18", dueDate: "2026-11-16", dueTime: "18:00" });
    await newTask(user, { title: "Hoy sin hora", dueDate: "2026-11-16" });
    await newTask(user, { title: "Hoy 9", dueDate: "2026-11-16", dueTime: "09:00" });
    const late = await newTask(user, { title: "Vencida", dueDate: "2026-11-13" });
    await newTask(user, { title: "Jueves", dueDate: "2026-11-19" });
    const titles = async (view: string) => (await user.get(`/api/tasks?view=${view}`)).body.tasks.map((t: { title: string }) => t.title);
    expect(await titles("inbox")).toEqual(["Sin fecha"]);
    expect(await titles("today")).toEqual(["Hoy 9", "Hoy 18", "Hoy sin hora"]);
    expect(await titles("overdue")).toEqual(["Vencida"]);
    expect(await titles("upcoming")).toEqual(["Jueves"]);
    expect((await user.get(`/api/tasks/${late.id}`)).body.overdue).toBe(true);
    await user.post(`/api/tasks/${late.id}/complete`, {});
    expect(await titles("done")).toEqual(["Vencida"]);
    expect(await titles("overdue")).toEqual([]);
  });

  it("filters by list, tag and text (accent-insensitive)", async () => {
    const { user } = await setupUser();
    const casa = (await user.post("/api/lists", { name: "Casa" })).body;
    await newTask(user, { title: "Reunión con Martín", tags: ["trabajo"] });
    await newTask(user, { title: "Pagar luz", listId: casa.id, tags: ["casa", "pagos"] });
    expect((await user.get(`/api/tasks?listId=${casa.id}`)).body.tasks).toHaveLength(1);
    expect((await user.get("/api/tasks?tag=pagos")).body.tasks[0].title).toBe("Pagar luz");
    expect((await user.get("/api/tasks?q=reunion")).body.tasks[0].title).toBe("Reunión con Martín");
    const found = await user.get("/api/search?q=martin");
    expect(found.body.results[0]).toMatchObject({ type: "task", task: { title: "Reunión con Martín" } });
    expect((await user.get("/api/search?q=100%25")).body.results).toEqual([]); // wildcards are literal
  });

  it("update: reschedule, clear the date (and time + rrule), version conflicts", async () => {
    const { user } = await setupUser();
    const t = await newTask(user, { title: "Gym", dueDate: "2026-11-16", dueTime: "19:00", rrule: "freq=weekly;byday=mo,we" });
    expect(t.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    const moved = await user.patch(`/api/tasks/${t.id}`, { dueDate: "2026-11-18", version: 1 });
    expect(moved.body).toMatchObject({ dueDate: "2026-11-18", dueTime: "19:00", version: 2 });
    const stale = await user.patch(`/api/tasks/${t.id}`, { title: "Gym!", version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details.current.version).toBe(2);
    const cleared = await user.patch(`/api/tasks/${t.id}`, { dueDate: null });
    expect(cleared.body).toMatchObject({ dueDate: null, dueTime: null, rrule: null });
    expect((await user.patch(`/api/tasks/${t.id}`, { dueTime: "10:00" })).status).toBe(400);
    expect((await user.patch(`/api/tasks/${t.id}`, { rrule: "FREQ=HOURLY", dueDate: "2026-11-20" })).body.error.message).toMatch(
      /diaria, semanal, mensual o anual/,
    );
  });

  it("completing a recurring task creates the next occurrence; undo removes it", async () => {
    const { user } = await setupUser();
    const t = await newTask(user, { title: "Basura", dueDate: "2026-11-13", dueTime: "08:30", rrule: "FREQ=DAILY" });
    const done = await user.post(`/api/tasks/${t.id}/complete`, {});
    // overdue since Friday, completed Monday → Tuesday (completing counts for today)
    expect(done.body.next).toMatchObject({ dueDate: "2026-11-17", dueTime: "08:30", seriesId: t.id, status: "open" });
    expect(done.body.task).toMatchObject({ status: "done", seriesId: t.id });
    expect((await user.post(`/api/tasks/${t.id}/complete`, {})).body.next).toBeNull(); // idempotent
    const undo = await user.post(`/api/tasks/${t.id}/reopen`, { nextId: done.body.next.id });
    expect(undo.body.status).toBe("open");
    expect((await user.get(`/api/tasks/${done.body.next.id}`)).status).toBe(404);
  });

  it("delete is soft and lists move their tasks to the Inbox; the Inbox can't be deleted", async () => {
    const { user } = await setupUser();
    const casa = (await user.post("/api/lists", { name: "Casa" })).body;
    const t = await newTask(user, { title: "Regar", listId: casa.id });
    expect((await user.post("/api/lists", { name: "casa" })).status).toBe(409);
    const del = await user.del(`/api/lists/${casa.id}`);
    expect(del.body.movedToInbox).toBe(1);
    const inbox = (await user.get("/api/lists")).body.lists[0];
    expect((await user.get(`/api/tasks/${t.id}`)).body.listId).toBe(inbox.id);
    expect((await user.del(`/api/lists/${inbox.id}`)).body.error.message).toMatch(/La Inbox no se puede borrar/);
    expect((await user.del(`/api/tasks/${t.id}`)).status).toBe(204);
    expect((await user.get(`/api/tasks/${t.id}`)).status).toBe(404);
  });

  it("reorder within one list", async () => {
    const { user } = await setupUser();
    const a = await newTask(user, { title: "A" });
    const b = await newTask(user, { title: "B" });
    const c = await newTask(user, { title: "C" });
    const r = await user.post("/api/tasks/reorder", { ids: [c.id, a.id, b.id] });
    expect(r.body.tasks.map((t: { title: string }) => t.title)).toEqual(["C", "A", "B"]);
    expect((await user.get("/api/tasks?view=inbox")).body.tasks.map((t: { title: string }) => t.title)).toEqual(["C", "A", "B"]);
  });

  it("offline creates with a client id are idempotent through Idempotency-Key", async () => {
    const { user } = await setupUser();
    const id = "019a0a6e-1c00-7000-8000-0000000000aa";
    const first = await user.post("/api/tasks", { id, title: "Offline" }, { "Idempotency-Key": id });
    const replay = await user.post("/api/tasks", { id, title: "Offline" }, { "Idempotency-Key": id });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await user.post("/api/tasks", { id, title: "Otra" })).status).toBe(409); // same id, no key
  });

  it("Sunday (token) can read and write tasks; items are marked as hers", async () => {
    const { user } = await setupUser();
    const token = (await user.post("/api/tokens", { name: "sunday", scopes: ["read", "write"] })).body.token;
    const sunday = client("anon");
    const auth = { authorization: `Bearer ${token}` };
    const created = await sunday.post("/api/tasks", { title: "Comprar regalo", dueDate: "2026-11-20" }, auth);
    expect(created.status).toBe(201);
    expect(created.body.source).toBe("sunday");
    expect((await sunday.get("/api/tasks?view=upcoming", auth)).body.tasks).toHaveLength(1);
    const [log] = await getDb().select().from(changeLog).where(eq(changeLog.entityId, created.body.id));
    expect(log?.actor).toBe("sunday");
    expect(log?.tokenId).toBeTruthy();
  });

  it("'today' follows the user's timezone, not the server's", async () => {
    const { user } = await setupUser();
    await newTask(user, { title: "Lunes", dueDate: "2026-11-16" });
    setNow("2026-11-17T01:30:00-03:00"); // already Tuesday in Buenos Aires
    expect((await user.get("/api/tasks?view=overdue")).body.tasks).toHaveLength(1);
    await user.patch("/api/settings", { timezone: "America/Los_Angeles" }); // still Monday 20:30 there
    expect((await user.get("/api/tasks?view=today")).body.tasks).toHaveLength(1);
  });
});
