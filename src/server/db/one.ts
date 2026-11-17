/**
 * The single row of a query that must return one: `insert … returning`, `update … returning` on a row that was just
 * found, or a lookup by a key known to exist. An empty result is a bug, so it fails loudly (500) instead of
 * propagating `undefined`. For lookups where "not found" is a valid outcome, check `rows[0]` and throw a 404.
 */
export function one<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`${what}: expected one row, got none`);
  return row;
}
