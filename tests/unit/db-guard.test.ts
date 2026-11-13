import { describe, expect, it } from "vitest";
import { assertTestDatabase, databaseName } from "@/server/db/guard";

describe("test database guard", () => {
  it("accepts only databases whose name ends in _test", () => {
    expect(assertTestDatabase("postgres://agenda:agenda@localhost:5433/agenda_test")).toContain("agenda_test");
    expect(assertTestDatabase("postgres://a:b@db/agenda_e2e_test?sslmode=disable")).toContain("agenda_e2e_test");
  });

  it("refuses dev, production and look-alike names", () => {
    for (const url of [
      "postgres://agenda:agenda@localhost:5433/agenda_dev",
      "postgres://agenda:x@postgres-core:5432/agenda",
      "postgres://agenda:x@db/agenda_test_backup",
      "postgres://agenda:x@db/",
    ])
      expect(() => assertTestDatabase(url)).toThrow(/Refusing/);
    expect(() => assertTestDatabase(undefined)).toThrow(/TEST_DATABASE_URL/);
  });

  it("reads the name from the URL path, ignoring credentials and query", () => {
    expect(databaseName("postgres://u:p%40ss@h:1/agenda_test?x=1")).toBe("agenda_test");
  });
});
