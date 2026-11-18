import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { now } from "@/server/domain/time";
import { prune } from "@/server/jobs/prune";
import { client, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll("2026-11-16T08:00:00-03:00"));
afterAll(() => closeDb());

type Entry = { action: string; label: string | null; entity: string; actor: string; tokenName: string | null; fields: string[] };

describe("completed things are history", () => {
  it("a completed task, a done reminder and a habit with checked days can't be deleted", async () => {
    const { user } = await setupUser();
    const t = (await user.post("/api/tasks", { title: "Llamar al contador" })).body;
    await user.post(`/api/tasks/${t.id}/complete`, {});
    const del = await user.del(`/api/tasks/${t.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/completada/);
    // reopening it first is the explicit way out
    await user.post(`/api/tasks/${t.id}/reopen`, {});
    expect((await user.del(`/api/tasks/${t.id}`)).status).toBe(204);

    const r = (await user.post("/api/reminders", { title: "Remedio", fireAt: "2026-11-16T09:00:00-03:00" })).body;
    await user.post(`/api/reminders/${r.id}/done`, {});
    expect((await user.del(`/api/reminders/${r.id}`)).status).toBe(409);

    await user.post("/api/habits", { name: "Gym" });
    await user.post("/api/habits/gym/log", {});
    expect((await user.del("/api/habits/gym")).status).toBe(409);
    await user.post("/api/habits", { name: "Leer" });
    expect((await user.del("/api/habits/leer")).status).toBe(204); // never checked: fine
  });
});

describe("audit", () => {
  it("lists every change newest first, in plain terms, with who did it", async () => {
    const { user } = await setupUser();
    const token = (await user.post("/api/tokens", { name: "sunday", scopes: ["read", "write"] })).body.token as string;
    const sunday = client("anon");
    const auth = { authorization: `Bearer ${token}` };

    const t = (await user.post("/api/tasks", { title: "Llamar al contador" })).body;
    await user.patch(`/api/tasks/${t.id}`, { title: "Llamar al contador (urgente)", notes: "IVA" });
    await sunday.post(`/api/tasks/${t.id}/complete`, {}, auth);
    const r = (await user.post("/api/reminders", { title: "Remedio", fireAt: "2026-11-16T09:00:00-03:00" })).body;
    await user.post(`/api/reminders/${r.id}/snooze`, { minutes: 30 });
    await user.del(`/api/reminders/${r.id}`);
    await user.post("/api/habits", { name: "Gym" });
    await user.post("/api/habits/gym/log", {});
    await user.post("/api/habits/gym/log", { done: false });

    const all = (await user.get("/api/audit")).body;
    expect(all.next).toBeNull();
    expect(all.entries.map((e: Entry) => [e.action, e.label])).toEqual([
      ["unchecked", "Gym · 2026-11-16"],
      ["checked", "Gym · 2026-11-16"],
      ["created", "Gym"],
      ["cancelled", "Remedio"],
      ["rescheduled", "Remedio"],
      ["created", "Remedio"],
      ["completed", "Llamar al contador (urgente)"],
      ["edited", "Llamar al contador (urgente)"],
      ["created", "Llamar al contador"],
    ]);
    const completed = all.entries.find((e: Entry) => e.action === "completed");
    expect(completed).toMatchObject({ actor: "sunday", tokenName: "sunday", entity: "task" });
    expect(all.entries.find((e: Entry) => e.action === "edited").fields.sort()).toEqual(["notes", "title"]);

    const onlyReminders = (await user.get("/api/audit?kind=reminder")).body.entries;
    expect(onlyReminders.map((e: Entry) => e.action)).toEqual(["cancelled", "rescheduled", "created"]);

    // pages
    const first = (await user.get("/api/audit?limit=4")).body;
    expect(first.entries).toHaveLength(4);
    const second = (await user.get(`/api/audit?limit=4&before=${first.next}`)).body;
    expect(second.entries[0].label).toBe("Remedio");
    expect([...first.entries, ...second.entries].map((e: Entry) => e.action)).toEqual(all.entries.slice(0, 8).map((e: Entry) => e.action));
  });

  it("a deleted item stays readable after it's purged; the audit is never pruned; only the app reads it", async () => {
    const { user } = await setupUser();
    const t = (await user.post("/api/tasks", { title: "Comprar pintura" })).body;
    await user.del(`/api/tasks/${t.id}`);
    setNow("2026-12-20T08:00:00-03:00");
    const purged = await prune(getDb(), now());
    expect(purged.task).toBe(1);
    const entries = (await user.get("/api/audit")).body.entries;
    expect(entries.map((e: Entry) => [e.action, e.label])).toEqual([
      ["deleted", "Comprar pintura"],
      ["created", "Comprar pintura"],
    ]);

    const token = (await user.post("/api/tokens", { name: "sunday", scopes: ["read"] })).body.token as string;
    expect((await client("anon").get("/api/audit", { authorization: `Bearer ${token}` })).status).toBe(403);
  });
});
