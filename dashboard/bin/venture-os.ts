#!/usr/bin/env node
// Self-supervising launcher.
//
// Two modes, distinguished by JANUS_BRIDGE_CHILD:
//   - parent (default): spawns a child running this same script with the env
//     flag set, watches it, respawns on any exit. Ctrl+C/SIGTERM forwards to
//     the child and shuts the parent down.
//   - child (JANUS_BRIDGE_CHILD=1): runs the actual bridge in-process. Calling
//     `process.exit(0)` from inside the bridge (e.g. POST /api/bridge/restart)
//     causes the parent supervisor to spin up a fresh bridge.
//
// This is what makes the click-to-restart on the dashboard's status ring work
// without touching the dash script or the .cmd launcher.

import { spawn, type ChildProcess } from "node:child_process";

const PORT = parseInt(process.env.VENTURE_OS_PORT || "3100", 10);
const IS_CHILD = process.env.JANUS_BRIDGE_CHILD === "1";

async function runBridge(): Promise<void> {
  const { startServer } = await import("../bridge/server.js");
  await startServer(PORT);
  console.log(`\n  Venture OS bridge running on http://localhost:${PORT}\n`);

  if (process.env.CODESPACES) {
    try {
      // @ts-ignore - open may not be installed
      const open = await import(/* webpackIgnore: true */ "open");
      await open.default(`http://localhost:${PORT}`);
    } catch { /* fine if not installed */ }
  }
}

function runSupervisor(): void {
  let child: ChildProcess | null = null;
  let shuttingDown = false;
  let restartsInWindow = 0;
  let windowStartedAt = Date.now();

  function spawnChild(): void {
    // Re-exec the current script with the same node + loader flags (e.g. the
    // tsx --import flag). This avoids paying npx startup cost on every restart.
    const args = [...process.execArgv, ...process.argv.slice(1)];
    child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: { ...process.env, JANUS_BRIDGE_CHILD: "1" },
    });
    child.on("exit", (code, signal) => {
      child = null;
      if (shuttingDown) return;
      const now = Date.now();
      if (now - windowStartedAt > 60_000) {
        windowStartedAt = now;
        restartsInWindow = 0;
      }
      restartsInWindow++;
      if (restartsInWindow > 5) {
        console.error(`[supervisor] bridge crashed ${restartsInWindow} times in <60s — giving up. Last exit: code=${code} signal=${signal}`);
        process.exit(1);
      }
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.log(`[supervisor] bridge exited (${reason}), restarting...`);
      setTimeout(spawnChild, 250);
    });
    child.on("error", (err) => {
      console.error("[supervisor] failed to spawn bridge:", err);
    });
  }

  function shutdown(sig: NodeJS.Signals): void {
    shuttingDown = true;
    if (child && !child.killed) {
      try { child.kill(sig); } catch {}
      setTimeout(() => { try { child?.kill("SIGKILL"); } catch {} process.exit(0); }, 3000);
    } else {
      process.exit(0);
    }
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  spawnChild();
}

if (IS_CHILD) {
  runBridge().catch((err) => {
    console.error("Failed to start Venture OS bridge:", err);
    process.exit(1);
  });
} else {
  runSupervisor();
}
