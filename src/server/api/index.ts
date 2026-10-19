import { handle, registerHandlers } from "../http/router";
import { handlers } from "./handlers";

registerHandlers(handlers);

/** Single entry point for /api/* (used by the catch-all route and the tests). */
export { handle };
