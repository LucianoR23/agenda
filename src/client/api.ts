import type { Problem } from "./types";

/** Thrown for problem+json responses. `offline` is set when the network itself failed. */
export class ApiProblem extends Error {
  constructor(
    readonly problem: Problem,
    readonly offline = false,
  ) {
    super(problem.detail ?? problem.title);
  }
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
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiProblem({ status: 0, title: "Sin conexión" }, true);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const problem: Problem = data ?? { status: res.status, title: res.statusText };
    if (res.status === 401 && path !== "/api/auth/unlock" && !path.startsWith("/api/auth/recover") && !path.startsWith("/api/auth/passkey/auth"))
      authListeners.forEach((l) => l(problem));
    throw new ApiProblem(problem);
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

export const get = <T>(path: string) => api<T>("GET", path).then((r) => r.data);
