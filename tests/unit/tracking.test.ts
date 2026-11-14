import { describe, expect, it } from "vitest";
import { slugify } from "@/server/domain/habits";
import { nightOfBed } from "@/server/domain/sleep";
import { periodOf } from "@/server/domain/stats";

const tz = "America/Buenos_Aires";
const I = (s: string) => Temporal.Instant.from(s);

describe("sleep night", () => {
  it("bed from noon on belongs to the next morning; after midnight, to that morning", () => {
    expect(nightOfBed(I("2026-11-18T23:40:00-03:00"), tz)).toBe("2026-11-19");
    expect(nightOfBed(I("2026-11-19T00:30:00-03:00"), tz)).toBe("2026-11-19");
    expect(nightOfBed(I("2026-11-19T11:59:00-03:00"), tz)).toBe("2026-11-19");
    expect(nightOfBed(I("2026-11-19T12:00:00-03:00"), tz)).toBe("2026-11-20");
  });
});

describe("habits", () => {
  it("slug from a Spanish name", () => {
    expect(slugify("Lectura diaria")).toBe("lectura-diaria");
    expect(slugify("Ñandú & Café!")).toBe("nandu-cafe");
    expect(slugify("¡¡!!")).toBe("habito");
  });
});

describe("metric periods", () => {
  it("week (Mon–Sun), month and year around a date", () => {
    expect(periodOf("week", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(periodOf("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodOf("year", "2026-11-18")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});
