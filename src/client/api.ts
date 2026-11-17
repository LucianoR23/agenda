import type { Problem } from "./types";

/** Thrown for error responses. `offline` is set when the network itself failed. */
export class ApiProblem extends Error {
  constructor(
    readonly problem: Problem,
    readonly offline = false,
  ) {
    super(problem.message);
  }
}

/** Reads `{ error: { code, message, details } }`; anything else (proxy pages, empty bodies) gets a generic message. */
function toProblem(status: number, data: unknown): Problem {
  const e = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined)?.error;
  return { status, code: e?.code, message: e?.message ?? `Error ${status}`, details: e?.details };
}

type Listener = (p: Problem) => void;
const authListeners = new Set<Listener>();
/** The auth gate listens for 401s (locked / logged out) to show the unlock screen. */
export const onAuthProblem = (l: Listener) => {
  authListeners.add(l);
  return () => void authListeners.delete(l);
};

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiProblem({ status: 0, message: "Sin conexión." }, true);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const problem = toProblem(res.status, data);
    if (
      res.status === 401 &&
      path !== "/api/auth/unlock" &&
      !path.startsWith("/api/auth/recover") &&
      !path.startsWith("/api/auth/passkey/auth")
    )
      for (const l of authListeners) l(problem);
    throw new ApiProblem(problem);
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

export const get = <T>(path: string) => api<T>("GET", path).then((r) => r.data);
