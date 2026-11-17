import { describe, expect, it } from "vitest";
import { dayLabel, monthLabel, seenLabel, shortDow } from "@/ui/time";

describe("client time labels", () => {
  it("names days relative to today", () => {
    expect(dayLabel("2026-11-13", "2026-11-13")).toBe("Hoy · Viernes 13");
    expect(dayLabel("2026-11-12", "2026-11-13")).toBe("Ayer · Jueves 12");
    expect(dayLabel("2026-11-14", "2026-11-13")).toBe("Mañana · Sábado 14");
    expect(dayLabel("2026-11-16", "2026-11-13")).toBe("Lunes 16");
    expect(monthLabel("2026-11-13")).toBe("noviembre 2026");
    expect(shortDow("2026-11-15")).toBe("D");
  });

  it("shows when a device was last seen in the user's timezone", () => {
    const tz = "America/Buenos_Aires";
    expect(seenLabel("2026-11-13T20:31:00Z", tz, "2026-11-13")).toBe("hoy 17:31");
    expect(seenLabel("2026-11-13T02:10:00Z", tz, "2026-11-13")).toBe("ayer 23:10"); // still the 12th locally
    expect(seenLabel("2026-10-12T23:00:00Z", tz, "2026-11-13")).toBe("12/10 20:00");
  });
});
