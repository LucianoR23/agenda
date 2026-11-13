/** Runs once per server start. Node-only work lives in instrumentation-node.ts (never bundled for the Edge runtime). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
