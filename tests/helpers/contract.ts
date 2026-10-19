import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

/**
 * Contract check against the committed openapi.yaml: every response the tests receive is validated
 * against the documented schema for its path, method, status and content type.
 */
type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: object }> }> }>>;
  components: object;
};

const doc = parse(readFileSync("openapi.yaml", "utf8")) as Doc;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const templates = Object.keys(doc.paths).map((p) => ({
  path: p,
  regex: new RegExp(`^${p.replace(/\{\w+\}/g, "[^/]+")}$`),
  literals: p.split("/").filter((s) => s && !s.startsWith("{")).length,
}));
templates.sort((a, b) => b.literals - a.literals);

const cache = new Map<string, ReturnType<typeof ajv.compile>>();
export const coverage = new Set<string>();

export function validateResponse(method: string, pathname: string, status: number, contentType: string | null, body: unknown) {
  const m = method.toLowerCase();
  const t = templates.find((x) => x.regex.test(pathname) && doc.paths[x.path][m]);
  if (!t) throw new Error(`Contract: no ${method} ${pathname} in openapi.yaml`);
  const op = doc.paths[t.path][m];
  const res = op.responses[String(status)];
  if (!res) throw new Error(`Contract: ${method} ${t.path} does not document status ${status}`);
  coverage.add(`${method.toUpperCase()} ${t.path} ${status}`);
  if (!res.content) {
    if (body !== undefined && body !== null && body !== "") throw new Error(`Contract: ${method} ${t.path} ${status} documents no body`);
    return;
  }
  const type = (contentType ?? "").split(";")[0];
  const media = res.content[type];
  if (!media) throw new Error(`Contract: ${method} ${t.path} ${status} documents ${Object.keys(res.content)}, got ${type}`);
  const key = `${m} ${t.path} ${status} ${type}`;
  let validate = cache.get(key);
  if (!validate) {
    validate = ajv.compile({ ...media.schema, components: doc.components });
    cache.set(key, validate);
  }
  if (!validate(body))
    throw new Error(`Contract: ${method} ${pathname} ${status} does not match openapi.yaml:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
}
