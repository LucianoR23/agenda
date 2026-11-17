import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  clock,
  DEFAULT_TIMEZONE,
  dateOf,
  dateRange,
  daysBetween,
  fixedClock,
  formatInstant,
  fromDate,
  isValidTimeZone,
  monthEnd,
  monthStart,
  now,
  setClock,
  systemClock,
  timeOf,
  toDate,
  today,
  toInstant,
  weekStart,
} from "@/server/domain/time";

const BA = DEFAULT_TIMEZONE;
const at = (iso: string) => Temporal.Instant.from(iso);

afterEach(() => setClock(null));

describe("clock", () => {
  it("is injectable, movable and restorable", () => {
    const c = fixedClock("2026-11-13T02:59:00Z");
    setClock(c);
    expect(now().toString()).toBe("2026-11-13T02:59:00Z");
    expect(today(BA)).toBe("2026-11-12"); // 23:59 in Buenos Aires
    c.advance({ minutes: 1 });
    expect(today(BA)).toBe("2026-11-13");
    setClock(null);
    expect(clock()).toBe(systemClock);
  });
});

describe("timezones", () => {
  it("local date and time change at local midnight, not UTC midnight", () => {
    expect(dateOf(at("2026-11-13T02:59:59Z"), BA)).toBe("2026-11-12");
    expect(dateOf(at("2026-11-13T03:00:00Z"), BA)).toBe("2026-11-13");
    expect(timeOf(at("2026-11-13T03:05:00Z"), BA)).toBe("00:05");
  });

  it("formats with the zone's real offset (no hard-coded -03:00)", () => {
    expect(formatInstant(at("2026-11-13T11:35:00.888Z"), BA)).toBe("2026-11-13T08:35:00.888-03:00");
    expect(formatInstant(new Date("2026-11-13T11:35:00Z"), BA)).toBe("2026-11-13T08:35:00.000-03:00");
    expect(formatInstant(at("2026-07-01T12:00:00Z"), "Europe/Madrid")).toBe("2026-07-01T14:00:00.000+02:00");
    expect(formatInstant(at("2026-01-15T12:00:00Z"), "Europe/Madrid")).toBe("2026-01-15T13:00:00.000+01:00");
  });

  it("local date + time → instant, start of day by default", () => {
    expect(toInstant("2026-11-13", "09:00", BA).toString()).toBe("2026-11-13T12:00:00Z");
    expect(toInstant("2026-11-13", null, BA).toString()).toBe("2026-11-13T03:00:00Z");
  });

  it("DST gaps and overlaps resolve like a calendar app (compatible)", () => {
    // Madrid 2026-03-29: 02:00 → 03:00 (02:30 does not exist) and 2026-10-25: 03:00 → 02:00 (02:30 happens twice)
    expect(formatInstant(toInstant("2026-03-29", "02:30", "Europe/Madrid"), "Europe/Madrid")).toBe("2026-03-29T03:30:00.000+02:00");
    expect(formatInstant(toInstant("2026-10-25", "02:30", "Europe/Madrid"), "Europe/Madrid")).toBe("2026-10-25T02:30:00.000+02:00");
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone("America/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("converts at the database boundary without losing milliseconds", () => {
    const i = at("2026-11-13T11:35:00.888Z");
    expect(fromDate(toDate(i)).equals(i)).toBe(true);
  });
});

describe("calendar dates", () => {
  it("adds days across months and years, leap years included", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-01", "2026-11-13")).toBe(12);
    expect(daysBetween("2026-11-13", "2026-11-01")).toBe(-12);
  });

  it("weeks start on Monday; month bounds", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday → previous Monday
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(monthStart("2026-11-13")).toBe("2026-11-01");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
  });

  it("ranges are inclusive and empty when reversed", () => {
    expect(dateRange("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(dateRange("2026-11-13", "2026-11-12")).toEqual([]);
  });
});
