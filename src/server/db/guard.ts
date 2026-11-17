/** Database name from a connection URL (`postgres://u:p@host:5432/agenda_test` → `agenda_test`). */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/**
 * Tests never touch a real database: anything whose name doesn't end in `_test` is refused before a single
 * query runs. Used by the Vitest/Playwright setup and by the DB client whenever it runs under a test runner.
 */
export function assertTestDatabase(url: string | undefined): string {
  if (!url) throw new Error("Refusing to run tests: no test database URL (set TEST_DATABASE_URL).");
  const name = databaseName(url);
  if (!name.endsWith("_test")) throw new Error(`Refusing to run tests against database "${name}": its name must end in _test.`);
  return url;
}

/** True under Vitest or Playwright's test server. */
export const underTestRunner = () => !!process.env.VITEST || process.env.NODE_ENV === "test";
