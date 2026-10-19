import { connection } from "next/server";
import { handle } from "@/server/api";

/**
 * Every /api route goes through one dispatcher that matches the request against the contract catalog
 * (src/contract/routes), so routing, validation and auth always follow openapi.yaml.
 */
async function dispatch(req: Request) {
  await connection(); // always request-time (Cache Components would otherwise try to prerender GETs)
  return handle(req);
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
