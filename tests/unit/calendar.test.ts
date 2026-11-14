import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPrivateAddress, parseIcal, setIcalFetch } from "@/server/calendar/ical";
import { open, seal } from "@/server/calendar/secretbox";
import { fromGoogle } from "@/server/calendar/sync";
import { eventOccurrences } from "@/server/domain/recurrence";

const ics = readFileSync("tests/fixtures/calendar.ics", "utf8");
const I = (s: string) => Temporal.Instant.from(s);

describe("iCal", () => {
  it("expands RRULE with EXDATE and a moved occurrence; all-day dates and tentative events", () => {
    const events = parseIcal(ics, I("2026-11-09T00:00:00Z"), I("2027-03-01T00:00:00Z"));
    const gym = events.filter((e) => e.title.startsWith("Gimnasio")).map((e) => [e.title, e.startsAt?.toString()]);
    expect(gym).toEqual([
      ["Gimnasio", "2026-11-16T22:00:00Z"],
      ["Gimnasio (movido)", "2026-11-24T23:00:00Z"], // the 23rd moved to the 24th at 20:00
      ["Gimnasio", "2026-12-07T22:00:00Z"], // the 30th is an EXDATE; COUNT=4 ends the series
    ]);
    // the moved one keeps the id of its original slot, so a reminder on it survives the move
    expect(events.find((e) => e.title === "Gimnasio (movido)")?.externalId).toBe("gym@google.com|2026-11-23T22:00:00Z");
    expect(events.find((e) => e.title === "Feriado")).toMatchObject({ allDay: true, startDate: "2026-11-20", endDate: "2026-11-21" });
    expect(events.find((e) => e.title === "Dentista")).toMatchObject({ status: "tentative", location: null });
  });

  it("rejects what isn't a calendar", () => {
    expect(() => parseIcal("<html>nope</html>", I("2026-11-09T00:00:00Z"), I("2027-03-01T00:00:00Z"))).toThrow(/iCal/);
  });

  it("refuses private and loopback addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.5",
      "172.20.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["142.250.79.46", "8.8.8.8", "2607:f8b0:4002::1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("only https, never private hosts, before any download", async () => {
    setIcalFetch(null);
    const { fetchIcal } = await import("@/server/calendar/ical");
    await expect(fetchIcal("http://calendar.google.com/x.ics")).rejects.toThrow(/https/);
    await expect(fetchIcal("https://127.0.0.1/x.ics")).rejects.toThrow(/red privada/);
    await expect(fetchIcal("https://user:pw@example.com/x.ics")).rejects.toThrow(/usuario/);
  });
});

describe("Google events", () => {
  it("maps timed, all-day and cancelled instances", () => {
    expect(
      fromGoogle({
        id: "a",
        status: "confirmed",
        summary: " Daily ",
        start: { dateTime: "2026-11-18T09:30:00-03:00" },
        end: { dateTime: "2026-11-18T09:45:00-03:00" },
        htmlLink: "https://www.google.com/calendar/event?eid=YQ",
      }),
    ).toMatchObject({
      title: "Daily",
      allDay: false,
      startsAt: I("2026-11-18T12:30:00Z"),
      htmlLink: "https://www.google.com/calendar/event?eid=YQ",
    });
    expect(fromGoogle({ id: "b", start: { date: "2026-11-20" }, end: { date: "2026-11-21" } })).toMatchObject({
      allDay: true,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
      title: "(Sin título)",
    });
    expect(fromGoogle({ id: "c", status: "cancelled" })).toBeNull();
    // a link anywhere but google.com is dropped
    expect(fromGoogle({ id: "d", start: { date: "2026-11-20" }, htmlLink: "https://evil.example/x" })?.htmlLink).toBeNull();
  });
});

describe("secretbox", () => {
  it("round-trips and detects tampering", () => {
    const sealed = seal("1//refresh-token");
    expect(Buffer.from(sealed).toString("utf8")).not.toContain("refresh");
    expect(open(sealed)).toBe("1//refresh-token");
    const bad = Buffer.from(sealed);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    expect(() => open(bad)).toThrow();
  });
});

describe("event recurrence", () => {
  it("expands occurrences overlapping a range, including one that started before it", () => {
    const dtstart = Temporal.ZonedDateTime.from("2026-11-16T23:00[America/Buenos_Aires]");
    const two = 2 * 3600_000; // 23:00–01:00
    const occ = eventOccurrences("FREQ=DAILY;COUNT=5", dtstart, two, I("2026-11-18T03:30:00Z"), I("2026-11-19T03:00:00Z"));
    // the 17th's occurrence runs until 01:00 on the 18th (local) → overlaps the range starting 00:30 local
    expect(occ.map((z) => z.toPlainDate().toString())).toEqual(["2026-11-17", "2026-11-18"]);
  });
});
