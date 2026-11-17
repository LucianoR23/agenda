import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/ui/quick-add";

const MON = "2026-11-16"; // Monday

describe("quick add", () => {
  it("mañana 9 llamar al contador", () => {
    expect(parseQuickAdd("mañana 9 llamar al contador", MON)).toMatchObject({
      title: "llamar al contador",
      dueDate: "2026-11-17",
      dueTime: "09:00",
      rrule: null,
    });
    expect(parseQuickAdd("llamar al contador mañana 9", MON)).toMatchObject({ title: "llamar al contador", dueTime: "09:00" });
  });

  it("el jueves a las 18 pagar luz #casa !alta", () => {
    expect(parseQuickAdd("el jueves a las 18 pagar luz #casa !alta", MON)).toMatchObject({
      title: "pagar luz",
      dueDate: "2026-11-19",
      dueTime: "18:00",
      listName: "casa",
      priority: 3,
    });
  });

  it("todos los lunes 8:30 sacar la basura", () => {
    expect(parseQuickAdd("todos los lunes 8:30 sacar la basura", MON)).toMatchObject({
      title: "sacar la basura",
      dueDate: MON, // today is Monday: first occurrence today
      dueTime: "08:30",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    expect(parseQuickAdd("cada martes y jueves gym", MON)).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=TU,TH", dueDate: "2026-11-17" });
    expect(parseQuickAdd("regar todos los días", MON)).toMatchObject({ title: "regar", rrule: "FREQ=DAILY", dueDate: MON });
    expect(parseQuickAdd("reporte días de semana a las 10", MON)).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      dueTime: "10:00",
    });
  });

  it("15/12 cumple Ana and other dates", () => {
    expect(parseQuickAdd("15/12 cumple Ana", MON)).toMatchObject({ title: "cumple Ana", dueDate: "2026-12-15", dueTime: null });
    expect(parseQuickAdd("3/2 renovar dni", MON).dueDate).toBe("2027-02-03"); // already passed this year
    expect(parseQuickAdd("turno médico el 24 de diciembre a las 10:15", MON)).toMatchObject({
      title: "turno médico",
      dueDate: "2026-12-24",
      dueTime: "10:15",
    });
    expect(parseQuickAdd("pasado mañana dentista", MON).dueDate).toBe("2026-11-18");
    expect(parseQuickAdd("en 3 días llamar", MON).dueDate).toBe("2026-11-19");
    expect(parseQuickAdd("el lunes reunión", MON).dueDate).toBe("2026-11-23"); // "el lunes" said on a Monday = next one
    expect(parseQuickAdd("31/2 nada", MON).dueDate).toBeNull();
  });

  it("time alone means today; tags; untouched text stays in the title", () => {
    expect(parseQuickAdd("18hs llamar a mamá +familia +Familia", MON)).toMatchObject({
      title: "llamar a mamá",
      dueDate: MON,
      dueTime: "18:00",
      tags: ["familia"],
    });
    expect(parseQuickAdd("comprar 2 kilos de pan", MON)).toMatchObject({ title: "comprar 2 kilos de pan", dueDate: null, dueTime: null });
    expect(parseQuickAdd("hoy 25 cosas", MON)).toMatchObject({ dueDate: MON, dueTime: null, title: "25 cosas" }); // 25 isn't an hour
  });
});
