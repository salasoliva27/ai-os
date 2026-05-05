#!/usr/bin/env node
/**
 * Unified dev launcher — starts bridge + Vite, prints ONE URL.
 * Usage: tsx bin/dev.ts
 */
import { startServer } from "../bridge/server.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_PORT = parseInt(process.env.VENTURE_OS_PORT || "3100", 10);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  // 1. Start bridge server (API + WebSocket) — no URL printed
  await startServer(BRIDGE_PORT);
  console.log(`\x1b[36m  [bridge]\x1b[0m ready on :${BRIDGE_PORT} (internal)`);
  console.log();

  // 2. Start Vite dev server — its output becomes our primary output
  const frontendDir = path.join(root, "frontend");
  const vite = spawn("npx", ["vite", "--port", "5180", "--host", "0.0.0.0"], {
    cwd: frontendDir,
    stdio: "inherit",
    env: { ...process.env },
  });

  vite.on("exit", (code) => {
    process.exit(code || 0);
  });

  // Graceful shutdown — kill Vite, bridge shuts down with process
  const shutdown = () => {
    vite.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start Venture OS:", err);
  process.exit(1);
});
