/**
 * Shared helpers for the OpenAPI examples. Every example is validated against its schema when the spec is generated.
 */

/** Deterministic UUIDv7-shaped ids for examples. */
export const uid = (n: number) => `019a0a6e-1c00-7000-8000-${n.toString(16).padStart(12, "0")}`;

/** `url` of an item in the examples (production origin). */
export const appUrl = (path: string) => `https://agenda.lemydev.com${path}`;
