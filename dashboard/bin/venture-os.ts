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

// ── Always-off dashboard auth ─────────────────────────────────────────────
// Janus runs locally on the user's machine (Claude Code + terminal-bound
// engines need filesystem/process access; the dashboard is a UI for that
// local agent). Network exposure is opt-in (a Tailscale node, an Oracle
// VM, etc.) — and even then, the local machine is already sitting behind
// OS auth. Every recurring dashboard login was friction without security
// value, and forced us to bake a shared password into the synced repo to
// get cross-instance access. Strip the auth env vars at supervisor boot
// so `auth.ts` ENFORCE evaluates false and the sign-in page disappears.
// Re-enable by exporting JANUS_AUTH_USER + JANUS_AUTH_PASSWORD_HASH +
// JANUS_AUTH_FORCE=true if you ever expose this to the public internet.
delete process.env.JANUS_AUTH_USER;
delete process.env.JANUS_AUTH_PASSWORD_HASH;
delete process.env.JANUS_AUTH_FORCE;

// ── Brand isolation ──────────────────────────────────────────────────────
// Downstream brand instances (Pablo AI, JP AI, AI OS, …) must not inherit
// the upstream owner's credentials. The user's `~/.env` is a single shared
// file, so without explicit stripping every downstream would silently log
// into the upstream owner's Anthropic / OpenAI / GitHub / Jira / TMC
// accounts.
//
// Two-layer defense:
//   1. dash skips ~/.env and dotfiles/.env when JANUS_HOME_ENV=0 (set by
//      every downstream brand's .cmd launcher).
//   2. This strip is the belt-and-suspenders for the case where someone
//      runs without the .cmd. Skipped when JANUS_HOME_ENV=0 because then
//      the home .env was never loaded, so there's nothing to strip and
//      stripping would WRONGLY remove the downstream owner's own values
//      that came from <workspace>/.env.
//
// Each downstream owner stores their own creds in <workspace>/.env (e.g.
// pablo-ia/.env), which dash loads first regardless of the home flag.
// That file is gitignored so it never propagates.
//
// Done at supervisor launch, before any module captures env at load time
// (auth.ts and several MCP sidecars latch env to module-level constants).
const BRAND = process.env.JANUS_BRAND || "Janus IA";
const HOME_ENV_LOADED = process.env.JANUS_HOME_ENV !== "0";
if (BRAND !== "Janus IA" && HOME_ENV_LOADED) {
  const STRIP = [
    // Engines (Anthropic / OpenAI / Google direct API keys)
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    // GitHub — drives the Projects panel listing repos
    "GITHUB_TOKEN",
    "GITHUB_TOKEN_REECE",
    "GH_TOKEN",
    // Jira / Atlassian — drives Tickets panel; covers both spellings the
    // bridge reads (JIRA_API_KEY in jira.ts, JIRA_API_TOKEN as fallback).
    "JIRA_TOKEN", "JIRA_API_TOKEN", "JIRA_API_KEY",
    "JIRA_HOST", "JIRA_BASE_URL", "JIRA_EMAIL",
    "ATLASSIAN_API_TOKEN", "CONFLUENCE_TOKEN",
    // Talend Cloud — drives Talend panel
    "TMC_TOKEN", "TMC_HOST", "TALEND_TOKEN", "TALEND_API_KEY",
    // Snowflake — drives the SQL console
    "SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_ROLE", "SNOWFLAKE_DATABASE",
    "SNOWFLAKE_SCHEMA",
    // Workday — Reece-specific HR / FIS extracts
    "WORKDAY_USER", "WORKDAY_PASSWORD",
    "WORKDAY_HOST", "WORKDAY_TENANT", "WORKDAY_FIS_SAAS_REPORT_URL",
    // Supabase — chat archive + brain_events. Each downstream owner
    // configures their own; until then, falls back to localStorage-only.
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF",
    // Notion / Slack
    "NOTION_TOKEN", "SLACK_TOKEN", "SLACK_BOT_TOKEN",
    // Knowledge graph / Neo4j
    "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD",
    // Bitso (espacio-bosques DAO; Mexico-specific, never used by downstream brands)
    "BITSO_API_KEY", "BITSO_API_SECRET",
    // Brave search / Voyage embeddings (per-account API keys)
    "BRAVE_API_KEY", "VOYAGE_API_KEY",
    // AWS — Reece-specific bucket access
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION",
    "AWS_SESSION_TOKEN",
    // Google OAuth + service-account JSON paths (Calendar / Drive / Gmail
    // MCPs use these; each downstream owner connects their own account)
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
    "GOOGLE_ACCESS_TOKEN", "GOOGLE_REFRESH_TOKEN",
    "GCAL_CREDENTIALS", "GDRIVE_CREDENTIALS", "GMAIL_CREDENTIALS",
    // Oracle Cloud Infrastructure (Reece's deployment cluster)
    "OCID", "tenancy", "region", "fingerprint",
  ];
  for (const k of STRIP) delete process.env[k];
  console.log(`[brand-isolation] ${BRAND}: stripped ${STRIP.length} upstream credential(s) before bridge boot`);
} else if (BRAND !== "Janus IA") {
  console.log(`[brand-isolation] ${BRAND}: JANUS_HOME_ENV=0 — strip skipped (downstream owner's <workspace>/.env values preserved)`);
}

// Default to a different port for non-janus-ia brands so all instances can
// run side-by-side without colliding. Order: explicit VENTURE_OS_PORT wins;
// then janus-ia → 3100, every other brand → 3101 (override per-brand if you
// run more than two simultaneously).
function defaultPortForBrand(brand: string): number {
  if (brand === "Janus IA") return 3100;
  return 3101;
}
const PORT = parseInt(process.env.VENTURE_OS_PORT || String(defaultPortForBrand(BRAND)), 10);
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
