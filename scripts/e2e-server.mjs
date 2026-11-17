// Starts the production standalone server for Playwright, like the Docker image does: the standalone output needs
// .next/static and public/ next to it. PORT comes from the environment.

import { spawn } from "node:child_process";
import { cpSync } from "node:fs";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });
const server = spawn(process.execPath, ["server.js"], { cwd: ".next/standalone", stdio: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
