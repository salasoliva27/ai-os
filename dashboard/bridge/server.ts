import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "./types.js";
import { isValidClientMessage } from "./types.js";
import { SessionManager } from "./session-manager.js";
import { PermissionManager } from "./permissions.js";
import { clearAgentAuthCache, getAgent, getClaudeSubscriptionAuthStatus, kickClaudeProbeBackground, listAgentAvailability, readVarFromDotfiles } from "./agent-registry.js";
import { startWatchers, stopWatchers, broadcastInitialLearnings } from "./file-watcher.js";
import {
  broadcastInitialProjectStates,
  startProjectStateRefresh,
  refreshOneProject,
  wikiSlugFromPath,
  projectStateSnapshot,
  sendProjectsSnapshot,
  sendCalendarSnapshot,
  discoveredReposForSync,
} from "./project-state.js";
import { bootstrapAllRepos } from "./bootstrap-status.js";
import { syncAllWikis, syncOneWiki } from "./wiki-sync.js";
import {
  startJiraPolling,
  pollJiraOnce,
  fetchTicketDetail,
  sendTicketsSnapshot,
  jiraSnapshot,
  getCachedTickets,
  listTransitions,
  applyTransition,
  addComment,
} from "./jira.js";
import {
  startTalendPolling,
  pollTalendOnce,
  sendTalendSnapshot,
  talendSnapshot,
  getCachedJobs,
  fetchExecutionsFor,
  triggerJob,
  getCachedSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "./talend.js";
import type { FSWatcher } from "chokidar";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync, spawn } from "node:child_process";
import { McpSupervisor, defaultSidecars } from "./mcp-supervisor.js";
import { memoryHealthSnapshot, captureSessionSummary } from "./memory-capture.js";
import { mountAuth } from "./auth.js";
import { syncCodexMcpConfig } from "./codex-config.js";
import { workspaceStateSlug } from "./path-utils.js";

// DASH_HOME = where the dashboard code lives (janus-ia/dashboard/..). Always
// derived from this file's own location so it works regardless of wrapper mode.
// WORKSPACE_ROOT = the repo the bridge is serving (may differ from DASH_HOME
// when launched via a wrapper in another repo).
const DASH_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || DASH_HOME;
const WORKSPACE_NAME = path.basename(WORKSPACE_ROOT);
const ENGINE_PROJECT_DIR = workspaceStateSlug(WORKSPACE_ROOT);
const IS_CODESPACES = process.env.CODESPACES === "true" || !!process.env.CODESPACE_NAME;
const CLAUDE_CODESPACES_OAUTH_MESSAGE =
  "Claude subscription OAuth cannot be completed from Codespaces because Claude redirects to a localhost callback owned by the CLI process. Run the dashboard or Claude CLI from your local machine to refresh subscription auth, or use ANTHROPIC_API_KEY in this Codespace.";
const UPLOADS_DIR = path.join(WORKSPACE_ROOT, "dump", "uploads");
const JANUS_STATE_DIR = path.join(os.homedir(), ".janus", "projects", ENGINE_PROJECT_DIR);
const LEGACY_CLAUDE_STATE_DIR = path.join(os.homedir(), ".claude", "projects", ENGINE_PROJECT_DIR);
const THEMES_DIR = path.join(JANUS_STATE_DIR, "themes");
const LEGACY_THEMES_DIR = path.join(LEGACY_CLAUDE_STATE_DIR, "themes");
const MEMORY_DIR = path.join(JANUS_STATE_DIR, "memory");
const LEGACY_MEMORY_DIR = path.join(LEGACY_CLAUDE_STATE_DIR, "memory");
const MEMORY_DIRS = Array.from(new Set([MEMORY_DIR, LEGACY_MEMORY_DIR]));

function existingMemoryDirs(): string[] {
  return MEMORY_DIRS.filter(dir => fs.existsSync(dir));
}

function findMemoryFile(name: string): string | null {
  for (const dir of existingMemoryDirs()) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Persistent Snowflake connection — auth once at first query, reuse forever.
// MFA token caching means even a fresh process skips the Duo push for ~4h.
type SnowflakeConn = Awaited<ReturnType<typeof openSnowflakeConn>>;
let snowflakeConnPromise: Promise<SnowflakeConn> | null = null;

async function openSnowflakeConn() {
  const { default: snowflake } = await import("snowflake-sdk");
  const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    role: process.env.SNOWFLAKE_ROLE,
    authenticator: "USERNAME_PASSWORD_MFA",
    clientRequestMfaToken: true,
    clientStoreTemporaryCredential: true,
  } as Parameters<typeof snowflake.createConnection>[0]);
  await new Promise<void>((resolve, reject) => {
    conn.connect(err => (err ? reject(err) : resolve()));
  });
  return conn;
}

async function getSnowflakeConn() {
  if (!snowflakeConnPromise) {
    snowflakeConnPromise = openSnowflakeConn().catch(err => {
      snowflakeConnPromise = null;
      throw err;
    });
  }
  const conn = await snowflakeConnPromise;
  // Reset cache if the connection died so the next call reconnects
  if (!conn.isUp()) {
    snowflakeConnPromise = null;
    return getSnowflakeConn();
  }
  return conn;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

export function startServer(port: number): Promise<http.Server> {
  const app = express();
  // Raise the JSON body limit — chat uploads arrive as base64, and a ~10MB
  // PDF becomes ~14MB base64. 30MB gives comfortable headroom.
  app.use(express.json({ limit: "30mb" }));

  // Bridge owns MCP sidecar lifecycle so UI-driven engine sessions don't lose
  // MCPs across conversations. Each sidecar runs HTTP transport; .mcp.json
  // references them by URL instead of binding lifecycle to one provider CLI.
  const mcpSupervisor = new McpSupervisor();
  for (const def of defaultSidecars(DASH_HOME)) {
    mcpSupervisor.spawn(def);
  }
  try {
    const sync = syncCodexMcpConfig(WORKSPACE_ROOT, DASH_HOME);
    console.log(
      `[codex-mcp] ${sync.written ? "updated" : "checked"} ${sync.path} (${sync.servers.length} server${sync.servers.length === 1 ? "" : "s"})`,
    );
    if (sync.skipped.length > 0) console.warn("[codex-mcp] skipped:", sync.skipped.join("; "));
  } catch (err) {
    console.warn("[codex-mcp] sync failed:", err);
  }
  const shutdownMcp = () => {
    mcpSupervisor.shutdown().catch(err => console.error("mcp shutdown error:", err));
  };
  process.once("SIGTERM", shutdownMcp);
  process.once("SIGINT", shutdownMcp);

  // Auth gate (no-op when ENFORCE is false — see auth.ts). Mounted BEFORE any
  // routes so the cookie-session middleware applies to all of them, and
  // requireAuth fires before the route handlers.
  const auth = mountAuth(app);

  app.get("/api/mcp/status", (_req, res) => {
    res.json({ sidecars: mcpSupervisor.status() });
  });

  app.get("/api/workspace", (_req, res) => {
    res.json({ root: WORKSPACE_ROOT, name: WORKSPACE_NAME, memoryDir: MEMORY_DIR, memoryDirs: MEMORY_DIRS });
  });

  // Serve frontend static files in production
  const frontendDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
  }

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Build version — lets the UI show what's running and detect when the
  // on-disk checkout has moved past the version this tab loaded. When the
  // working tree is dirty, also returns `editedAt` so the badge can reflect
  // uncommitted edits (e.g. while the user is iterating on the UI). Cached
  // for 5s so polling clients don't repeat git/fs work on every request.
  type VersionPayload = {
    commit: string | null;
    commitTime: string | null;
    pulledAt: string | null;
    dirty: boolean;
    editedAt: string | null;
  };
  let versionCache: { value: VersionPayload; at: number } | null = null;
  const SOURCE_ROOTS = [
    path.join(DASH_HOME, "dashboard", "frontend", "src"),
    path.join(DASH_HOME, "dashboard", "bridge"),
  ];
  const SOURCE_EXCLUDES = new Set(["node_modules", "dist", ".git", ".next", "build"]);
  function maxMtime(root: string): number {
    let max = 0;
    const stack: string[] = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (SOURCE_EXCLUDES.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile()) {
          try {
            const m = fs.statSync(full).mtimeMs;
            if (m > max) max = m;
          } catch {}
        }
      }
    }
    return max;
  }
  app.get("/api/version", (_req, res) => {
    const now = Date.now();
    if (versionCache && now - versionCache.at < 5_000) {
      res.json(versionCache.value);
      return;
    }
    const value: VersionPayload = {
      commit: null, commitTime: null, pulledAt: null, dirty: false, editedAt: null,
    };
    try {
      value.commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: DASH_HOME, encoding: "utf8" }).trim();
    } catch {}
    try {
      value.commitTime = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: DASH_HOME, encoding: "utf8" }).trim();
    } catch {}
    try {
      const fetchHead = path.join(DASH_HOME, ".git", "FETCH_HEAD");
      const headFile = path.join(DASH_HOME, ".git", "HEAD");
      const stat = fs.existsSync(fetchHead) ? fs.statSync(fetchHead) : fs.existsSync(headFile) ? fs.statSync(headFile) : null;
      if (stat) value.pulledAt = stat.mtime.toISOString();
    } catch {}
    try {
      const status = execFileSync("git", ["status", "--porcelain"], { cwd: DASH_HOME, encoding: "utf8" });
      value.dirty = status.trim().length > 0;
    } catch {}
    if (value.dirty) {
      let max = 0;
      for (const r of SOURCE_ROOTS) max = Math.max(max, maxMtime(r));
      if (max > 0) value.editedAt = new Date(max).toISOString();
    }
    versionCache = { value, at: now };
    res.json(value);
  });

  // Bridge restart — exits the current process so the supervisor (bin/venture-os.ts
  // in parent mode) respawns a fresh bridge. The frontend's WebSocket reconnect
  // logic brings the status ring back to green within ~1s of the new bridge
  // listening. If the bridge wasn't launched under the supervisor, this is a
  // hard shutdown and the user has to relaunch manually.
  app.post("/api/bridge/restart", (_req, res) => {
    const supervised = process.env.JANUS_BRIDGE_CHILD === "1";
    res.json({ ok: true, supervised, message: supervised ? "restarting" : "exiting (no supervisor — relaunch manually)" });
    setTimeout(() => process.exit(0), 200);
  });

  // Diagnostic: shows which GitHub accounts the bridge sees, how many repos
  // each one discovered, and the merged project list. Useful when the
  // projects window is empty and you want to know whether discovery ran.
  app.get("/api/projects/state", (_req, res) => {
    try {
      res.json(projectStateSnapshot());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Force a fresh discovery pass + broadcast — exposed so the user can
  // trigger it from the UI / a curl without restarting the bridge.
  app.post("/api/projects/refresh", async (_req, res) => {
    try {
      await broadcastInitialProjectStates(broadcast);
      res.json({ ok: true, ...projectStateSnapshot() });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ── Jira ────────────────────────────────────────────────────────────
  app.get("/api/jira/tickets", (_req, res) => {
    res.json({ tickets: getCachedTickets() });
  });

  app.get("/api/jira/tickets/:key", async (req, res) => {
    const detail = await fetchTicketDetail(req.params.key);
    if (!detail) return void res.status(404).json({ error: "ticket not found or Jira not configured" });
    res.json(detail);
  });

  app.post("/api/jira/refresh", async (_req, res) => {
    await pollJiraOnce(broadcast);
    res.json({ ok: true, ...jiraSnapshot() });
  });

  app.get("/api/jira/state", (_req, res) => {
    res.json(jiraSnapshot());
  });

  // Available status transitions for a ticket (e.g. "Start", "Done").
  app.get("/api/jira/tickets/:key/transitions", async (req, res) => {
    const transitions = await listTransitions(req.params.key);
    res.json({ transitions });
  });

  // Apply a status transition. Body: { transitionId: string }
  app.post("/api/jira/tickets/:key/transition", async (req, res) => {
    const { transitionId } = (req.body || {}) as { transitionId?: string };
    if (!transitionId) return void res.status(400).json({ ok: false, error: "transitionId required" });
    const r = await applyTransition(req.params.key, transitionId);
    if (r.ok) {
      // Refresh so the new status surfaces in the panel immediately.
      pollJiraOnce(broadcast).catch(() => {});
    }
    res.status(r.ok ? 200 : 502).json(r);
  });

  // Post a comment to a ticket. Body: { body: string }
  app.post("/api/jira/tickets/:key/comment", async (req, res) => {
    const { body } = (req.body || {}) as { body?: string };
    if (!body || !body.trim()) return void res.status(400).json({ ok: false, error: "body required" });
    const r = await addComment(req.params.key, body.trim());
    res.status(r.ok ? 200 : 502).json(r);
  });

  // ── Talend ────────────────────────────────────────────────────────────
  app.get("/api/talend/jobs", (_req, res) => {
    res.json({ jobs: getCachedJobs() });
  });
  app.get("/api/talend/jobs/:id/executions", async (req, res) => {
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const executions = await fetchExecutionsFor(req.params.id, limit);
    res.json({ executions });
  });
  app.post("/api/talend/jobs/:id/run", async (req, res) => {
    const r = await triggerJob(req.params.id);
    if (r.ok) pollTalendOnce(broadcast).catch(() => {});
    res.status(r.ok ? 200 : 502).json(r);
  });
  app.post("/api/talend/refresh", async (_req, res) => {
    await pollTalendOnce(broadcast);
    res.json({ ok: true, ...talendSnapshot() });
  });
  app.get("/api/talend/state", (_req, res) => {
    res.json(talendSnapshot());
  });

  // Schedules — read/create/update/delete. The PAT scope blocks `/executables`
  // but allows full CRUD on `/schedules`, so this is what's actually possible
  // today. Body shape (POST/PUT):
  //   { executableId, environmentId, description?, trigger: { type, ... } }
  app.get("/api/talend/schedules", (_req, res) => {
    res.json({ schedules: getCachedSchedules() });
  });
  app.post("/api/talend/schedules", async (req, res) => {
    const r = await createSchedule(req.body);
    if (r.ok) pollTalendOnce(broadcast).catch(() => {});
    res.status(r.ok ? 200 : 502).json(r);
  });
  app.put("/api/talend/schedules/:id", async (req, res) => {
    const r = await updateSchedule(req.params.id, req.body);
    if (r.ok) pollTalendOnce(broadcast).catch(() => {});
    res.status(r.ok ? 200 : 502).json(r);
  });
  app.delete("/api/talend/schedules/:id", async (req, res) => {
    const r = await deleteSchedule(req.params.id);
    if (r.ok) pollTalendOnce(broadcast).catch(() => {});
    res.status(r.ok ? 200 : 502).json(r);
  });

  // Bootstrap `.janus/status.md` across all owned repos. Defaults to PR mode
  // (one PR per repo on the `janus/bootstrap-status` branch). Pass
  // `?mode=commit` to push directly to default branches instead, or
  // `?dryRun=1` to preview the targets without making any GitHub calls.
  app.post("/api/projects/bootstrap", async (req, res) => {
    const mode = (req.query.mode === "commit" ? "commit" : "pr") as "pr" | "commit";
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
    try {
      const summary = await bootstrapAllRepos({ mode, dryRun });
      // Refresh discovery so newly-bootstrapped repos surface their status data.
      if (!dryRun) {
        broadcastInitialProjectStates(broadcast).catch(() => {});
      }
      res.json({ ok: true, mode, dryRun, ...summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Graph data from real filesystem
  app.get("/api/graph", (_req, res) => {
    try {
      const data = buildGraphFromFs();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Usage brain — graph built from brain_events (MCP tool calls)
  app.get("/api/brain/events", async (_req, res) => {
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        res.status(500).json({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing", nodes: [], edges: [] });
        return;
      }
      const resp = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/brain_events?select=tool_name,workspace,project,status,created_at&workspace=eq.${encodeURIComponent(WORKSPACE_NAME)}&order=created_at.desc&limit=2000`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        res.status(resp.status).json({ error: `Supabase REST error: ${body.slice(0, 200)}`, nodes: [], edges: [] });
        return;
      }
      const rows = (await resp.json()) as Array<{ tool_name: string; workspace: string | null; project: string | null; status: string; created_at: string }>;
      res.json(buildUsageGraph(rows));
    } catch (err) {
      res.status(500).json({ error: String(err), nodes: [], edges: [] });
    }
  });

  // ─── Claude subscription auth (drives `claude auth ...` CLI) ────
  // Holds the active `claude auth login` child while we wait for the user
  // to complete the OAuth flow in their browser. One at a time.
  type LoginChild = import("node:child_process").ChildProcess;
  function isLoginChildRunning(child: LoginChild | null): child is LoginChild {
    return child !== null && child.exitCode === null && child.signalCode === null;
  }

  let claudeLoginChild: LoginChild | null = null;
  let claudeLoginUrl: string | null = null;

  function claudeCleanEnv(): NodeJS.ProcessEnv {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;
    return cleanEnv;
  }

  function readClaudeCredentialMeta(): { expiresAt?: number; accessTokenExpired?: boolean } {
    try {
      const file = path.join(os.homedir(), ".claude", ".credentials.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      const expiresAt = Number(parsed?.claudeAiOauth?.expiresAt);
      if (!Number.isFinite(expiresAt)) return {};
      return { expiresAt, accessTokenExpired: expiresAt <= Date.now() };
    } catch {
      return {};
    }
  }

  type ClaudeAuthStatus = {
    loggedIn?: boolean;
    authMethod?: string;
    envKeySet?: boolean;
    expiresAt?: number;
    accessTokenExpired?: boolean;
    usableForChat?: boolean;
    reauthRequired?: boolean;
    authProbeReason?: string;
    oauthUnavailableReason?: string;
    error?: string;
    raw?: string;
    [key: string]: unknown;
  };

  function isUsableClaudeSubscription(status: ClaudeAuthStatus): boolean {
    return status.loggedIn === true &&
      status.authMethod === "claude.ai" &&
      status.accessTokenExpired !== true;
  }

  function addClaudeOAuthAvailability(status: ClaudeAuthStatus): ClaudeAuthStatus {
    if (!IS_CODESPACES) return status;
    return {
      ...status,
      oauthUnavailableReason: CLAUDE_CODESPACES_OAUTH_MESSAGE,
    };
  }

  function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
    // claude auth status hides OAuth subscription details when ANTHROPIC_API_KEY
    // is in env (env wins, so it reports the env source instead). Strip the env
    // var for this probe so the UI sees the true subscription state.
    return new Promise((resolveStatus) => {
      execFile("claude", ["auth", "status", "--json"], { env: claudeCleanEnv(), timeout: 5_000, shell: process.platform === "win32" }, (err, stdout) => {
        if (err && !stdout) {
          resolveStatus({ loggedIn: false, error: String(err.message ?? err) });
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const baseStatus = addClaudeOAuthAvailability({ ...parsed, ...readClaudeCredentialMeta(), envKeySet: !!process.env.ANTHROPIC_API_KEY });
          const subscriptionProbe = isUsableClaudeSubscription(baseStatus)
            ? getClaudeSubscriptionAuthStatus()
            : { present: false, reason: undefined };
          // Only treat the probe as a hard auth failure when it explicitly
          // returns a 401 / "Reconnect" message. Generic execution failures
          // (CLI spawn errors, Windows PATH issues, timeouts) are transient —
          // trust the OAuth token that claude auth status already validated.
          const probeIsAuthError = typeof subscriptionProbe.reason === "string" &&
            /401|Reconnect/i.test(subscriptionProbe.reason);
          const oauthValid = isUsableClaudeSubscription(baseStatus);
          const status = {
            ...baseStatus,
            usableForChat: oauthValid ? (subscriptionProbe.present || !probeIsAuthError) : false,
            reauthRequired: oauthValid && !subscriptionProbe.present && probeIsAuthError,
            authProbeReason: subscriptionProbe.reason,
          };
          if (subscriptionProbe.present) clearAgentAuthCache("claude");
          resolveStatus(status);
        } catch {
          resolveStatus({ loggedIn: false, error: "could not parse claude output", raw: stdout.slice(0, 200) });
        }
      });
    });
  }

  app.get("/api/claude-auth/status", async (_req, res) => {
    try {
      res.json(await getClaudeAuthStatus());
    } catch (err) {
      res.status(500).json({ loggedIn: false, error: String(err) });
    }
  });

  app.post("/api/claude-auth/login", async (req, res) => {
    const force = req.query.force === "1";
    const status = await getClaudeAuthStatus();
    let forceRefresh = force;
    if (!force && isUsableClaudeSubscription(status)) {
      clearAgentAuthCache("claude");
      const subscriptionProbe = getClaudeSubscriptionAuthStatus();
      if (subscriptionProbe.present) {
        res.json({ loggedIn: true, alreadyLoggedIn: true, status: { ...status, usableForChat: true, reauthRequired: false } });
        return;
      }
      forceRefresh = true;
      status.usableForChat = false;
      status.reauthRequired = true;
      status.authProbeReason = subscriptionProbe.reason;
    }

    if (IS_CODESPACES) {
      if (isLoginChildRunning(claudeLoginChild)) {
        try { claudeLoginChild.kill(); } catch { /* ignore */ }
      }
      claudeLoginChild = null;
      claudeLoginUrl = null;
      res.status(409).json({ error: CLAUDE_CODESPACES_OAUTH_MESSAGE, status });
      return;
    }

    if (claudeLoginChild && !isLoginChildRunning(claudeLoginChild)) {
      claudeLoginChild = null;
      claudeLoginUrl = null;
    }
    if (isLoginChildRunning(claudeLoginChild)) {
      // Already mid-flow. Newer Claude builds may open the browser directly
      // without printing a URL, so a null URL still means "keep waiting".
      res.json({ url: claudeLoginUrl, opened: !claudeLoginUrl, alreadyRunning: true });
      return;
    }
    try {
      const cleanEnv: NodeJS.ProcessEnv = { ...claudeCleanEnv(), NO_COLOR: "1", FORCE_COLOR: "0" };
      if (forceRefresh) {
        try {
          execFileSync("claude", ["auth", "logout"], {
            env: cleanEnv,
            timeout: 5_000,
            shell: process.platform === "win32",
            stdio: "ignore",
          });
        } catch {
          // Continue into login; logout may report "not logged in" or be
          // shadowed by a broken token, and login is still the repair path.
        }
        clearAgentAuthCache("claude");
      }
      const child = spawn("claude", ["auth", "login", "--claudeai"], {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      claudeLoginChild = child;
      claudeLoginUrl = null;

      let buf = "";
      let resolved = false;
      const finish = (status: number, body: object) => {
        if (resolved) return;
        resolved = true;
        res.status(status).json(body);
      };

      const tryExtractUrl = () => {
        // Strip ANSI escapes that --claudeai sometimes still emits, then look
        // for the first current Claude/Anthropic OAuth URL.
        const clean = buf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const m = clean.match(/https:\/\/(?:(?:www\.)?claude\.ai|(?:www\.)?claude\.com|platform\.claude\.com|console\.anthropic\.com)\/[^\s\)\]\}>"']+/);
        if (m) {
          claudeLoginUrl = m[0];
          finish(200, { url: m[0] });
        }
      };

      child.stdout?.on("data", (d) => { buf += d.toString(); tryExtractUrl(); });
      child.stderr?.on("data", (d) => { buf += d.toString(); tryExtractUrl(); });
      child.on("exit", async (code, signal) => {
        claudeLoginChild = null;
        clearAgentAuthCache("claude");
        // Kick an async probe so the availability cache is warm for the next
        // /api/agents or /api/claude-auth/status poll. Non-blocking.
        kickClaudeProbeBackground();
        if (!resolved) {
          const status = await getClaudeAuthStatus();
          if (isUsableClaudeSubscription(status)) {
            finish(200, { loggedIn: true, alreadyLoggedIn: true, status });
            return;
          }
          finish(500, {
            error: "claude exited before opening an OAuth flow",
            exitCode: code,
            signal,
            raw: buf.slice(0, 500),
          });
        }
      });
      child.on("error", (e) => {
        claudeLoginChild = null;
        if (!resolved) finish(500, { error: String(e.message ?? e) });
      });

      // Safety: if no URL appears in 8s, do not kill the CLI. Claude Code
      // often opens the browser itself and never prints a URL on stdout/stderr.
      // Return success so the UI can poll auth status while the child process
      // stays alive to receive the OAuth callback.
      setTimeout(() => {
        if (!resolved) {
          finish(200, {
            opened: true,
            message: "Claude OAuth is running. Finish the browser authorization, then this panel will update.",
            raw: buf.slice(0, 500),
          });
        }
      }, 8_000);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/claude-auth/logout", async (_req, res) => {
    try {
      // Kill any in-flight login so it doesn't write fresh creds after we logout.
      if (isLoginChildRunning(claudeLoginChild)) {
        try { claudeLoginChild.kill(); } catch { /* ignore */ }
        claudeLoginChild = null;
        claudeLoginUrl = null;
      }
      execFile("claude", ["auth", "logout"], { env: claudeCleanEnv(), timeout: 5_000, shell: process.platform === "win32" }, (err, stdout, stderr) => {
        if (err) {
          res.status(500).json({ ok: false, error: String(err.message ?? err), stderr: String(stderr).slice(0, 300) });
          return;
        }
        clearAgentAuthCache("claude");
        res.json({ ok: true, output: stdout.trim() });
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ─── Codex (OpenAI) subscription auth ────────────────
  // Mirrors the Claude flow: spawn `codex login`, parse the OAuth URL it
  // prints, return it to the UI. The CLI hosts its own localhost callback.
  // Tokens persist in ~/.codex/ — survive bridge restart and new shells.
  let codexLoginChild: import("node:child_process").ChildProcess | null = null;
  let codexLoginUrl: string | null = null;

  app.get("/api/codex-auth/status", async (_req, res) => {
    try {
      const { execFile } = await import("node:child_process");
      // `codex login status` returns plain text: "Logged in" or "Not logged in".
      // OPENAI_API_KEY in env doesn't override OAuth the way Claude's does, but
      // we still report envKeySet so the UI can call out the fallback path.
      execFile("codex", ["login", "status"], { timeout: 5_000, shell: process.platform === "win32" }, (err, stdout, stderr) => {
        if (err && !stdout) {
          res.json({ loggedIn: false, error: String(err.message ?? err), envKeySet: !!(process.env.OPENAI_API_KEY || readVarFromDotfiles("OPENAI_API_KEY")) });
          return;
        }
        const out = (stdout + stderr).trim();
        const loggedIn = /logged\s*in/i.test(out) && !/not\s*logged\s*in/i.test(out);
        // Try to extract auth method (ChatGPT OAuth vs API key) from output.
        const isChatgpt = /chatgpt|oauth/i.test(out);
        const isApiKey = /api[-_\s]?key/i.test(out);
        const authMethod = loggedIn
          ? (isChatgpt ? "chatgpt" : (isApiKey ? "api-key" : "unknown"))
          : undefined;
        const emailMatch = out.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        const planMatch = out.match(/plan:?\s*([A-Za-z]+)/i);
        res.json({
          loggedIn,
          authMethod,
          email: emailMatch ? emailMatch[0] : null,
          subscriptionType: planMatch ? planMatch[1] : null,
          envKeySet: !!(process.env.OPENAI_API_KEY || readVarFromDotfiles("OPENAI_API_KEY")),
          raw: out.slice(0, 200),
        });
      });
    } catch (err) {
      res.status(500).json({ loggedIn: false, error: String(err) });
    }
  });

  app.post("/api/codex-auth/login", async (_req, res) => {
    if (codexLoginChild && !codexLoginChild.killed) {
      res.json({ url: codexLoginUrl, alreadyRunning: true });
      return;
    }
    try {
      const { spawn } = await import("node:child_process");
      // `codex login` (no flags) triggers ChatGPT OAuth browser flow and
      // prints the auth URL on stdout/stderr. Strip OPENAI_API_KEY so the CLI
      // doesn't short-circuit to API-key mode when one is present in env.
      const cleanEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" };
      delete cleanEnv.OPENAI_API_KEY;
      const child = spawn("codex", ["login"], {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      codexLoginChild = child;
      codexLoginUrl = null;

      let buf = "";
      let resolved = false;
      const finish = (status: number, body: object) => {
        if (resolved) return;
        resolved = true;
        res.status(status).json(body);
      };

      const tryExtractUrl = () => {
        const clean = buf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        // Match any of the OAuth URL shapes codex prints: chatgpt.com for the
        // browser flow, auth.openai.com for device code, platform.openai.com
        // as a secondary redirect host.
        const m = clean.match(/https:\/\/(?:chatgpt\.com|auth\.openai\.com|platform\.openai\.com)\/[^\s\)\]\}>"']+/);
        if (m) {
          codexLoginUrl = m[0];
          finish(200, { url: m[0] });
        }
      };

      child.stdout?.on("data", (d) => { buf += d.toString(); tryExtractUrl(); });
      child.stderr?.on("data", (d) => { buf += d.toString(); tryExtractUrl(); });
      child.on("exit", () => {
        codexLoginChild = null;
        if (!resolved) finish(500, { error: "codex exited before printing a URL", raw: buf.slice(0, 500) });
      });
      child.on("error", (e) => {
        codexLoginChild = null;
        if (!resolved) finish(500, { error: String(e.message ?? e) });
      });

      setTimeout(() => {
        if (!resolved) {
          try { child.kill(); } catch { /* ignore */ }
          finish(500, { error: "timed out waiting for OAuth URL", raw: buf.slice(0, 500) });
        }
      }, 8_000);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/codex-auth/logout", async (_req, res) => {
    try {
      if (codexLoginChild && !codexLoginChild.killed) {
        try { codexLoginChild.kill(); } catch { /* ignore */ }
        codexLoginChild = null;
        codexLoginUrl = null;
      }
      const { execFile } = await import("node:child_process");
      execFile("codex", ["logout"], { timeout: 5_000, shell: process.platform === "win32" }, (err, stdout, stderr) => {
        if (err) {
          res.status(500).json({ ok: false, error: String(err.message ?? err), stderr: String(stderr).slice(0, 300) });
          return;
        }
        res.json({ ok: true, output: stdout.trim() });
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Detect active ports
  app.get("/api/ports", async (_req, res) => {
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null", { encoding: "utf-8", timeout: 3000 });
      const ports: number[] = [];
      for (const m of out.matchAll(/:(\d+)\s/g)) {
        const p = parseInt(m[1]);
        if (p >= 3000 && p <= 9999 && !ports.includes(p)) ports.push(p);
      }
      res.json({ ports: ports.sort((a, b) => a - b) });
    } catch {
      res.json({ ports: [] });
    }
  });

  // Calendar API — proxy Google Calendar events
  app.get("/api/calendar/events", async (_req, res) => {
    try {
      // Try Google Calendar through an engine/tool session when available.
      // For now, return from environment if available, or use MCP direct
      const now = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      const timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + 28); // 4 weeks ahead

      // Try fetching from Google Calendar API directly if token is available
      const token = process.env.GOOGLE_CALENDAR_TOKEN;
      if (token) {
        const gcalUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=50`;
        const resp = await fetch(gcalUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { items?: unknown[] };
          res.json({ events: data.items || [], source: "google" });
          return;
        }
      }

      // Fallback: return empty (frontend will use calendarSlots)
      res.json({ events: [], source: "local" });
    } catch (err) {
      res.status(500).json({ error: String(err), events: [] });
    }
  });

  // Path helpers — the file APIs accept/emit forward-slash paths so the browser
  // can round-trip them safely on any OS. On Windows, `path.join` produces
  // backslashes; if we didn't normalize, the frontend would send backslash
  // paths back and the `startsWith(WORKSPACE_ROOT)` guard would reject them.
  const slash = (p: string) => p.replace(/\\/g, "/");
  const WORKSPACE_ROOT_SLASH = slash(WORKSPACE_ROOT);
  const isInsideWorkspace = (p: string) => slash(p).startsWith(WORKSPACE_ROOT_SLASH);

  // File API — read files for the editor
  app.get("/api/file", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath || !isInsideWorkspace(filePath)) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const stat = fs.statSync(filePath);
      res.json({ path: slash(filePath), content, size: stat.size, modified: stat.mtimeMs });
    } catch (err) {
      res.status(404).json({ error: `File not found: ${filePath}` });
    }
  });

  // File API — write files from the editor
  app.post("/api/file", (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || typeof filePath !== "string" || !isInsideWorkspace(filePath)) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    if (typeof content !== "string") {
      res.status(400).json({ error: "Content must be a string" });
      return;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      res.json({ ok: true, path: slash(filePath), size: content.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // File API — list directory
  app.get("/api/files", (req, res) => {
    const dirPath = (req.query.path as string) || path.join(WORKSPACE_ROOT, "dashboard/frontend/src");
    if (!isInsideWorkspace(dirPath)) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        path: slash(path.join(dirPath, e.name)),
        isDir: e.isDirectory(),
      })).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ path: slash(dirPath), items });
    } catch {
      res.status(404).json({ error: "Directory not found" });
    }
  });

  // File API — write a single file. Used by the document editor in the UI.
  app.post("/api/files/write", (req, res) => {
    const { path: filePath, content } = req.body || {};
    if (typeof filePath !== "string" || !isInsideWorkspace(filePath)) {
      res.status(400).json({ ok: false, error: "Invalid path — must be inside the workspace" });
      return;
    }
    if (typeof content !== "string") {
      res.status(400).json({ ok: false, error: "Missing content (string)" });
      return;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      const stat = fs.statSync(filePath);
      res.json({ ok: true, path: slash(filePath), size: stat.size, mtime: stat.mtimeMs });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Calendar API — proxy to Google Calendar (fallback to empty)
  app.get("/api/calendar/events", async (_req, res) => {
    try {
      // Try Google Calendar MCP — if not available, return empty
      // The CalendarPanel frontend gracefully falls back to local calendarSlots data
      res.json({ events: [] });
    } catch {
      res.json({ events: [] });
    }
  });

  // File API — move/rename
  app.post("/api/file/move", (req, res) => {
    const { from, to } = req.body;
    if (!from || !to || !isInsideWorkspace(from) || !isInsideWorkspace(to)) {
      res.status(400).json({ error: "Invalid paths" });
      return;
    }
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      res.json({ ok: true, from: slash(from), to: slash(to) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // SQL Console API — execute read queries against configured data tools.
  // Supabase: uses Management API /database/query (needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF).
  // Snowflake: returns a not-wired error (wiring deferred to phase 4).
  app.post("/api/sql/execute", async (req, res) => {
    const { tool, query } = req.body || {};
    if (typeof query !== "string" || !query.trim()) {
      res.status(400).json({ ok: false, error: "Missing query" });
      return;
    }
    if (tool !== "supabase" && tool !== "snowflake") {
      res.status(400).json({ ok: false, error: `Unknown tool: ${tool}` });
      return;
    }

    if (tool === "snowflake") {
      const need = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD"];
      const missing = need.filter(k => !process.env[k]);
      if (missing.length) {
        res.status(400).json({
          ok: false,
          error: `Missing Snowflake env vars: ${missing.join(", ")} — open the Key Vault to add them.`,
        });
        return;
      }
      try {
        const t0 = Date.now();
        const conn = await getSnowflakeConn();
        const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
          conn.execute({
            sqlText: query,
            complete: (err, _stmt, rowData) => (err ? reject(err) : resolve((rowData ?? []) as Record<string, unknown>[])),
          });
        });
        const elapsed = Date.now() - t0;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        res.json({ ok: true, rows, columns, rowCount: rows.length, elapsed });
      } catch (err) {
        const e = err as { message?: string; code?: string | number };
        res.status(500).json({ ok: false, error: e?.message ? `${e.message}${e.code ? ` (code ${e.code})` : ""}` : String(err) });
      }
      return;
    }

    try {
      const token = process.env.SUPABASE_ACCESS_TOKEN;
      const ref = process.env.SUPABASE_PROJECT_REF;
      if (!token) {
        res.status(400).json({ ok: false, error: "SUPABASE_ACCESS_TOKEN not set — open the Key Vault to add it." });
        return;
      }
      if (!ref) {
        res.status(400).json({ ok: false, error: "SUPABASE_PROJECT_REF not set — open the Key Vault to add it." });
        return;
      }

      const t0 = Date.now();
      const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      const elapsed = Date.now() - t0;
      const text = await resp.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = text; }

      if (!resp.ok) {
        res.status(resp.status).json({ ok: false, error: body, elapsed });
        return;
      }
      // Management API returns an array of rows for SELECT, or [] / empty for DDL.
      const rows = Array.isArray(body) ? body : [];
      const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
      res.json({ ok: true, rows, columns, rowCount: rows.length, elapsed });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // MCP config — lists every MCP server declared in .mcp.json, resolves the
  // env-var references (e.g. ${GITHUB_TOKEN}), and reports which are present
  // in process.env. Values are NEVER returned — only presence.
  app.get("/api/mcp/list", (_req, res) => {
    try {
      const raw = fs.readFileSync(path.join(WORKSPACE_ROOT, ".mcp.json"), "utf-8");
      const cfg = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      const servers = cfg.mcpServers || {};
      const entries = Object.entries(servers).map(([name, rawSpec]) => {
        const spec = rawSpec as Record<string, unknown>;
        const envObj = (spec.env as Record<string, string> | undefined) || {};
        const envVars = Object.entries(envObj).map(([k, v]) => {
          // Values look like "${VAR_NAME}" — extract the referenced env var name
          const match = typeof v === "string" ? v.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/) : null;
          const sourceVar = match ? match[1] : null;
          const present = sourceVar ? typeof process.env[sourceVar] === "string" && process.env[sourceVar]!.length > 0 : true;
          return { key: k, sourceVar, present, literal: !sourceVar };
        });
        const missing = envVars.filter(v => !v.present).map(v => v.key);
        return {
          name,
          type: (spec.type as string) || "stdio",
          command: (spec.command as string) || null,
          args: (spec.args as string[]) || [],
          url: (spec.url as string) || null,
          envVars,
          status: missing.length === 0 ? "ready" : "needs-env",
          missing,
        };
      });
      res.json({ ok: true, servers: entries, configPath: path.join(WORKSPACE_ROOT, ".mcp.json") });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // MCP add/remove — mutates .mcp.json then commits + pushes the change. Like
  // /api/credentials/save, nothing is reported as "saved" unless write + commit
  // + push all succeed. The agent CLIs (claude/codex) re-read .mcp.json on each
  // turn (every chat = a fresh CLI process), so no in-flight restart is needed
  // — the next user message picks up the new server.
  const MCP_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/i;
  const MCP_CONFIG_PATH = path.join(WORKSPACE_ROOT, ".mcp.json");

  function readMcpConfig(): { mcpServers: Record<string, unknown> } {
    const raw = fs.readFileSync(MCP_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.mcpServers) {
      return { mcpServers: {} };
    }
    return { mcpServers: parsed.mcpServers as Record<string, unknown> };
  }

  function writeMcpConfig(cfg: { mcpServers: Record<string, unknown> }): void {
    const json = JSON.stringify(cfg, null, 2) + "\n";
    fs.writeFileSync(MCP_CONFIG_PATH, json, { encoding: "utf-8" });
  }

  function validateServerSpec(spec: unknown): { ok: true } | { ok: false; error: string } {
    if (!spec || typeof spec !== "object") return { ok: false, error: "spec must be an object" };
    const s = spec as Record<string, unknown>;
    const type = (s.type as string) ?? "stdio";
    if (type === "stdio" || s.command !== undefined) {
      if (typeof s.command !== "string" || s.command.length === 0) {
        return { ok: false, error: "stdio spec needs a command string" };
      }
      if (s.args !== undefined && (!Array.isArray(s.args) || !s.args.every(a => typeof a === "string"))) {
        return { ok: false, error: "args must be an array of strings" };
      }
      if (s.env !== undefined && (typeof s.env !== "object" || Array.isArray(s.env))) {
        return { ok: false, error: "env must be an object of {KEY: value}" };
      }
      return { ok: true };
    }
    if (type === "http") {
      if (typeof s.url !== "string" || s.url.length === 0) {
        return { ok: false, error: "http spec needs a url string" };
      }
      try { new URL(s.url.replace(/\$\{[^}]+\}/g, "x")); } catch { return { ok: false, error: "url is not a valid URL" }; }
      return { ok: true };
    }
    return { ok: false, error: `unknown type '${type}' — expected 'stdio' or 'http'` };
  }

  async function gitCommitMcpChange(verb: "add" | "remove", name: string): Promise<{ committed: boolean; pushed: boolean; sha: string | null; out: string }> {
    const { execFileSync } = await import("node:child_process");
    const git = (args: string[]): { ok: boolean; out: string } => {
      try {
        const out = execFileSync("git", args, {
          cwd: WORKSPACE_ROOT,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        });
        return { ok: true, out };
      } catch (err) {
        const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
        const stdout = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? "");
        const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? "");
        return { ok: false, out: `${stdout}\n${stderr}\n${e.message ?? ""}`.trim() };
      }
    };
    const addRes = git(["add", ".mcp.json"]);
    if (!addRes.ok) return { committed: false, pushed: false, sha: null, out: `git add: ${addRes.out}` };
    const verbVerb = verb === "add" ? "add" : "remove";
    const commitRes = git(["commit", "-m", `chore(mcp): ${verbVerb} ${name}`]);
    const sha = commitRes.ok ? git(["rev-parse", "HEAD"]).out.trim() : null;
    const pushRes = git(["push", "origin", "HEAD"]);
    return { committed: commitRes.ok, pushed: pushRes.ok, sha, out: `${commitRes.out}\n${pushRes.out}`.trim().slice(0, 500) };
  }

  app.post("/api/mcp/add", async (req, res) => {
    const body = (req.body || {}) as { name?: unknown; spec?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!MCP_NAME_RE.test(name)) {
      res.status(400).json({ ok: false, error: "name must be alphanumeric, hyphen, or underscore (≤64 chars)" });
      return;
    }
    const validation = validateServerSpec(body.spec);
    if (!validation.ok) {
      res.status(400).json({ ok: false, error: validation.error });
      return;
    }
    let cfg: { mcpServers: Record<string, unknown> };
    try { cfg = readMcpConfig(); }
    catch (err) { res.status(500).json({ ok: false, error: `read .mcp.json: ${String(err)}` }); return; }
    if (Object.prototype.hasOwnProperty.call(cfg.mcpServers, name)) {
      res.status(409).json({ ok: false, error: `MCP '${name}' already exists — remove it first or pick a different name` });
      return;
    }
    cfg.mcpServers[name] = body.spec as Record<string, unknown>;
    try { writeMcpConfig(cfg); }
    catch (err) { res.status(500).json({ ok: false, error: `write .mcp.json: ${String(err)}` }); return; }

    // Verify on disk before claiming success.
    const verify = readMcpConfig();
    const present = Object.prototype.hasOwnProperty.call(verify.mcpServers, name);
    if (!present) {
      res.status(500).json({ ok: false, error: "post-write verification failed — entry not present on disk" });
      return;
    }

    const git = await gitCommitMcpChange("add", name);
    const fullySaved = git.committed && git.pushed;
    res.json({
      ok: fullySaved,
      added: fullySaved ? name : null,
      staged: !fullySaved ? name : null,
      committed: git.committed,
      pushed: git.pushed,
      commit: git.sha,
      gitOutput: git.out,
    });
  });

  app.delete("/api/mcp/:name", async (req, res) => {
    const name = String(req.params.name || "").trim();
    if (!MCP_NAME_RE.test(name)) {
      res.status(400).json({ ok: false, error: "invalid name" });
      return;
    }
    let cfg: { mcpServers: Record<string, unknown> };
    try { cfg = readMcpConfig(); }
    catch (err) { res.status(500).json({ ok: false, error: `read .mcp.json: ${String(err)}` }); return; }
    if (!Object.prototype.hasOwnProperty.call(cfg.mcpServers, name)) {
      res.status(404).json({ ok: false, error: `MCP '${name}' not found in .mcp.json` });
      return;
    }
    delete cfg.mcpServers[name];
    try { writeMcpConfig(cfg); }
    catch (err) { res.status(500).json({ ok: false, error: `write .mcp.json: ${String(err)}` }); return; }

    const verify = readMcpConfig();
    if (Object.prototype.hasOwnProperty.call(verify.mcpServers, name)) {
      res.status(500).json({ ok: false, error: "post-write verification failed — entry still present on disk" });
      return;
    }

    const git = await gitCommitMcpChange("remove", name);
    const fullyRemoved = git.committed && git.pushed;
    res.json({
      ok: fullyRemoved,
      removed: fullyRemoved ? name : null,
      staged: !fullyRemoved ? name : null,
      committed: git.committed,
      pushed: git.pushed,
      commit: git.sha,
      gitOutput: git.out,
    });
  });

  // Credentials status — reports which env vars are currently present on the
  // bridge. Accepts a whitelist of names from the client; returns `{ name: bool }`.
  // We never return values — only presence.
  app.post("/api/credentials/status", (req, res) => {
    const names = Array.isArray((req.body as any)?.envVars) ? (req.body as any).envVars as unknown[] : [];
    const out: Record<string, boolean> = {};
    for (const n of names) {
      if (typeof n !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(n)) continue;
      const v = process.env[n] || readVarFromDotfiles(n);
      out[n] = typeof v === "string" && v.trim().length > 0;
    }
    res.json({ ok: true, envVars: out });
  });

  // Credentials test — validates a credential entry against its provider's API.
  // Accepts { entryId, fields: { envVar: value } }. Values missing in the body
  // fall back to process.env so "already set" credentials can still be tested.
  app.post("/api/credentials/test", async (req, res) => {
    const { entryId, fields } = (req.body || {}) as { entryId?: string; fields?: Record<string, string> };
    if (!entryId || typeof entryId !== "string") {
      res.status(400).json({ ok: false, error: "Missing entryId" });
      return;
    }
    const resolve = (envVar: string): string | undefined => {
      const v = fields?.[envVar];
      if (typeof v === "string" && v.trim()) return v.trim();
      const env = process.env[envVar];
      return env && env.trim() ? env.trim() : undefined;
    };
    const missing = (names: string[]): string[] => names.filter(n => !resolve(n));

    try {
      switch (entryId) {
        case "anthropic": {
          const miss = missing(["ANTHROPIC_API_KEY"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
            headers: { "x-api-key": resolve("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Anthropic /v1/models returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "Anthropic API key valid." });
        }
        case "openai": {
          const miss = missing(["OPENAI_API_KEY"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${resolve("OPENAI_API_KEY")}` },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `OpenAI /v1/models returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "OpenAI API key valid." });
        }
        case "github":
        case "github-reece": {
          const envName = entryId === "github-reece" ? "GITHUB_TOKEN_REECE" : "GITHUB_TOKEN";
          const miss = missing([envName]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${resolve(envName)}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "janus-credentials-test",
            },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `GitHub /user returned ${r.status}`, details: body.slice(0, 500) });
          let login = "unknown";
          try { login = (JSON.parse(body) as { login?: string }).login || "unknown"; } catch {}
          return void res.json({ ok: true, message: `GitHub token valid (user: ${login}).` });
        }
        case "jira": {
          const miss = missing(["JIRA_API_KEY", "JIRA_EMAIL", "JIRA_BASE_URL"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const baseUrl = resolve("JIRA_BASE_URL")!.replace(/\/+$/, "");
          const auth = Buffer.from(`${resolve("JIRA_EMAIL")}:${resolve("JIRA_API_KEY")}`, "utf-8").toString("base64");
          const r = await fetch(`${baseUrl}/rest/api/3/myself`, {
            headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Jira /myself returned ${r.status}`, details: body.slice(0, 500) });
          let display = "unknown";
          try { display = (JSON.parse(body) as { displayName?: string }).displayName || "unknown"; } catch {}
          return void res.json({ ok: true, message: `Jira credentials valid (${display}).` });
        }
        case "talend": {
          const miss = missing(["TALEND_API_KEY"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          // Probe the us-west tenant; if the user is on a different region, the
          // dashboard auto-detects on first real call. 200/401 both confirm the
          // token is well-formed (401 means the region is wrong, not the token).
          const r = await fetch("https://api.us-west.cloud.talend.com/orchestration/executables/", {
            headers: { Authorization: `Bearer ${resolve("TALEND_API_KEY")}`, Accept: "application/json" },
          });
          if (r.ok) return void res.json({ ok: true, message: "Talend token valid (us-west region)." });
          if (r.status === 401 || r.status === 403) return void res.json({ ok: false, status: r.status, error: "Talend rejected the token — wrong region or expired." });
          return void res.json({ ok: false, status: r.status, error: `Talend returned ${r.status}` });
        }
        case "brave": {
          const miss = missing(["BRAVE_API_KEY"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
            headers: { "X-Subscription-Token": resolve("BRAVE_API_KEY")!, Accept: "application/json" },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Brave search returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "Brave Search key valid." });
        }
        case "firecrawl": {
          const miss = missing(["FIRECRAWL_API_KEY"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", {
            headers: { Authorization: `Bearer ${resolve("FIRECRAWL_API_KEY")}` },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Firecrawl credit check returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "Firecrawl key valid." });
        }
        case "supabase-project": {
          const miss = missing(["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const url = resolve("SUPABASE_URL")!.replace(/\/+$/, "");
          const anon = resolve("SUPABASE_ANON_KEY")!;
          const r = await fetch(`${url}/rest/v1/`, {
            headers: { apikey: anon, Authorization: `Bearer ${anon}` },
          });
          if (!r.ok && r.status !== 404) {
            const body = await r.text();
            return void res.json({ ok: false, status: r.status, error: `Supabase REST returned ${r.status}`, details: body.slice(0, 500) });
          }
          // Optional: service-role key — if provided, test it too via same endpoint.
          const sr = resolve("SUPABASE_SERVICE_ROLE_KEY");
          if (sr) {
            const r2 = await fetch(`${url}/rest/v1/`, { headers: { apikey: sr, Authorization: `Bearer ${sr}` } });
            if (!r2.ok && r2.status !== 404) {
              const body2 = await r2.text();
              return void res.json({ ok: false, status: r2.status, error: `Service role key rejected (${r2.status})`, details: body2.slice(0, 500) });
            }
          }
          return void res.json({ ok: true, message: "Supabase project URL + keys valid." });
        }
        case "supabase-mgmt": {
          const miss = missing(["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch(`https://api.supabase.com/v1/projects/${resolve("SUPABASE_PROJECT_REF")}`, {
            headers: { Authorization: `Bearer ${resolve("SUPABASE_ACCESS_TOKEN")}` },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Supabase Management returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "Supabase management token + project ref valid." });
        }
        case "google-calendar": {
          const miss = missing(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: resolve("GOOGLE_CLIENT_ID")!,
              client_secret: resolve("GOOGLE_CLIENT_SECRET")!,
              refresh_token: resolve("GOOGLE_REFRESH_TOKEN")!,
              grant_type: "refresh_token",
            }),
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Google token refresh returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "Google OAuth refresh token valid." });
        }
        case "whatsapp-send": {
          const miss = missing(["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID"]);
          if (miss.length) return void res.json({ ok: false, error: `Missing: ${miss.join(", ")}` });
          const r = await fetch(`https://graph.facebook.com/v20.0/${resolve("WHATSAPP_BUSINESS_ACCOUNT_ID")}?fields=id,name`, {
            headers: { Authorization: `Bearer ${resolve("WHATSAPP_ACCESS_TOKEN")}` },
          });
          const body = await r.text();
          if (!r.ok) return void res.json({ ok: false, status: r.status, error: `Meta Graph returned ${r.status}`, details: body.slice(0, 500) });
          return void res.json({ ok: true, message: "WhatsApp send credentials valid." });
        }
        default:
          return void res.json({
            ok: false,
            error: `No automatic test wired for "${entryId}". Ask in chat to verify this one manually.`,
          });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Credentials save — writes env vars to the most appropriate .env file:
  //   1. Jano's Codespace dotfiles repo (sync'd across all his Codespaces)
  //      → commits + pushes + grep-verifies (4-step gate)
  //   2. If dotfiles dir doesn't exist (template/blank-slate fork), falls
  //      back to <WORKSPACE_ROOT>/.env — secrets stay local, no commit
  //      (and we make sure .env is gitignored so they don't leak)
  // process.env is updated either way so the running bridge sees the new
  // values on the next request without restart.
  app.post("/api/credentials/save", async (req, res) => {
    const body = (req.body || {}) as { fields?: Array<{ envVar?: unknown; value?: unknown }> };
    const fields = Array.isArray(body.fields) ? body.fields : [];
    if (fields.length === 0) {
      res.status(400).json({ ok: false, error: "No fields provided" });
      return;
    }
    const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]*$/;
    const clean: Array<{ envVar: string; value: string }> = [];
    for (const f of fields) {
      if (typeof f.envVar !== "string" || !ENV_VAR_RE.test(f.envVar)) {
        res.status(400).json({ ok: false, error: `Invalid env var name: ${String(f.envVar)}` });
        return;
      }
      if (typeof f.value !== "string" || f.value.length === 0) {
        res.status(400).json({ ok: false, error: `Missing value for ${f.envVar}` });
        return;
      }
      if (f.value.includes("\0") || f.value.includes("\n") || f.value.includes("\r")) {
        res.status(400).json({ ok: false, error: `Value for ${f.envVar} contains newlines or null bytes` });
        return;
      }
      clean.push({ envVar: f.envVar, value: f.value });
    }

    const DOTFILES_DIR = "/workspaces/.codespaces/.persistedshare/dotfiles";
    const DOTFILES_ENV = path.join(DOTFILES_DIR, ".env");
    const HOME_ENV = path.join(os.homedir(), ".env");
    const REPO_ENV = path.join(WORKSPACE_ROOT, ".env");
    const REPO_GITIGNORE = path.join(WORKSPACE_ROOT, ".gitignore");

    // Mode select: dotfiles repo if present, else local repo .env. The
    // dotfiles path is owner-specific (Jano's Codespace setup) — anyone
    // forking this template won't have it, so we write to their repo
    // root and never commit secrets into source control.
    const useDotfiles = fs.existsSync(DOTFILES_ENV);
    const TARGET_ENV = useDotfiles ? DOTFILES_ENV : REPO_ENV;

    // Double-quote-safe shell escaping: preserve the value verbatim when the
    // file is sourced by bash. Must escape \ " $ ` so the shell doesn't
    // interpret them.
    const shellQuote = (v: string): string => {
      const escaped = v
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
      return `"${escaped}"`;
    };

    // Ensure the target file exists and read current contents.
    let contents = "";
    if (fs.existsSync(TARGET_ENV)) {
      contents = fs.readFileSync(TARGET_ENV, "utf-8");
    }

    // Upsert each env var, preserving order and surrounding lines. If a line
    // already defines the var, replace it in place; otherwise append at end.
    const written: string[] = [];
    for (const { envVar, value } of clean) {
      const lineRe = new RegExp(`^(?:export\\s+)?${envVar}=.*$`, "m");
      const newLine = `export ${envVar}=${shellQuote(value)}`;
      if (lineRe.test(contents)) {
        contents = contents.replace(lineRe, newLine);
      } else {
        if (contents.length > 0 && !contents.endsWith("\n")) contents += "\n";
        contents += newLine + "\n";
      }
      written.push(envVar);
    }

    try {
      fs.writeFileSync(TARGET_ENV, contents, { encoding: "utf-8", mode: 0o600 });
      // Mirror to ~/.env only when we own the dotfiles flow — otherwise we
      // could clobber another tenant's home env.
      if (useDotfiles) {
        fs.writeFileSync(HOME_ENV, contents, { encoding: "utf-8", mode: 0o600 });
      }
      // In repo-local mode, make sure .env is gitignored so the user's
      // secrets don't get accidentally committed into a public template.
      if (!useDotfiles) {
        let gi = fs.existsSync(REPO_GITIGNORE) ? fs.readFileSync(REPO_GITIGNORE, "utf-8") : "";
        const hasEnv = gi.split("\n").some(l => l.trim() === ".env");
        if (!hasEnv) {
          if (gi.length > 0 && !gi.endsWith("\n")) gi += "\n";
          gi += ".env\n";
          fs.writeFileSync(REPO_GITIGNORE, gi, "utf-8");
        }
      }
      for (const { envVar, value } of clean) {
        process.env[envVar] = value;
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: `Failed to write .env: ${String(err)}` });
      return;
    }

    // Grep-verify: re-read the file and confirm every env var we claimed to
    // save is physically present with the expected value.
    const onDisk = fs.readFileSync(TARGET_ENV, "utf-8");
    const verified: string[] = [];
    const missing: string[] = [];
    for (const { envVar, value } of clean) {
      const expected = `export ${envVar}=${shellQuote(value)}`;
      if (onDisk.split("\n").includes(expected)) verified.push(envVar);
      else missing.push(envVar);
    }

    // Repo-local mode: write-and-verify is the whole gate. No commit; the
    // user's .env stays out of git so secrets don't leak.
    if (!useDotfiles) {
      const allVerified = missing.length === 0;
      res.json({
        ok: allVerified,
        saved: allVerified ? written : [],
        staged: !allVerified ? written : [],
        verified,
        missing,
        target: TARGET_ENV,
        mode: "repo-local",
        committed: false,
        pushed: false,
      });
      return;
    }

    // Dotfiles mode: full 4-step gate (write + commit + push + verify).
    const { execFileSync } = await import("node:child_process");
    const git = (args: string[]): { ok: boolean; out: string } => {
      try {
        const out = execFileSync("git", args, {
          cwd: DOTFILES_DIR,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        });
        return { ok: true, out };
      } catch (err) {
        const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
        const stdout = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? "");
        const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? "");
        return { ok: false, out: `${stdout}\n${stderr}\n${e.message ?? ""}`.trim() };
      }
    };

    const addRes = git(["add", ".env"]);
    if (!addRes.ok) {
      res.status(500).json({ ok: false, error: `git add failed: ${addRes.out}` });
      return;
    }
    const commitMsg = `chore(env): update ${written.join(", ")}`;
    const commitRes = git(["commit", "-m", commitMsg]);
    const commitSha = commitRes.ok ? git(["rev-parse", "HEAD"]).out.trim() : null;
    const pushRes = git(["push", "origin", "HEAD"]);

    const allVerified = missing.length === 0;
    const fullySaved = allVerified && commitRes.ok && pushRes.ok;
    res.json({
      ok: fullySaved,
      saved: fullySaved ? written : [],
      staged: !fullySaved ? written : [],
      verified,
      missing,
      target: TARGET_ENV,
      mode: "dotfiles",
      commit: commitSha,
      committed: commitRes.ok,
      pushed: pushRes.ok,
      commitOutput: commitRes.out.slice(0, 500),
      pushOutput: pushRes.out.slice(0, 500),
    });
  });

  // Custom tools registry — definitions for user-added tools (e.g. "Postmark").
  // Stored at <WORKSPACE_ROOT>/.dashboard/custom-tools.json so they survive
  // page reloads and can be shared across browsers/sessions on the same repo.
  // Only the *definition* lives here (env var names, MCP spec template, docs
  // link). Actual secret values still go to .env via /api/credentials/save.
  const TOOLS_REGISTRY_PATH = path.join(WORKSPACE_ROOT, ".dashboard", "custom-tools.json");

  type CustomToolField = {
    id: string;
    label: string;
    envVar: string;
    type: "password" | "text";
    placeholder?: string;
  };
  type CustomToolEntry = {
    id: string;
    name: string;
    scope: string;
    docsUrl?: string;
    fields: CustomToolField[];
    mcp?: { name: string; spec: Record<string, unknown> };
    createdAt: string;
  };

  function readToolsRegistry(): CustomToolEntry[] {
    if (!fs.existsSync(TOOLS_REGISTRY_PATH)) return [];
    try {
      const raw = fs.readFileSync(TOOLS_REGISTRY_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch { return []; }
  }

  function writeToolsRegistry(entries: CustomToolEntry[]): void {
    const dir = path.dirname(TOOLS_REGISTRY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOOLS_REGISTRY_PATH, JSON.stringify({ entries }, null, 2) + "\n", "utf-8");
  }

  app.get("/api/tools/list", (_req, res) => {
    res.json({ ok: true, entries: readToolsRegistry(), path: TOOLS_REGISTRY_PATH });
  });

  app.post("/api/tools/register", async (req, res) => {
    const body = (req.body || {}) as Partial<CustomToolEntry>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ ok: false, error: "name is required" });
      return;
    }
    const fields = Array.isArray(body.fields) ? body.fields : [];
    if (fields.length === 0) {
      res.status(400).json({ ok: false, error: "at least one credential field is required" });
      return;
    }
    const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]*$/;
    const cleanFields: CustomToolField[] = [];
    for (const f of fields) {
      if (!f || typeof f !== "object") {
        res.status(400).json({ ok: false, error: "field must be an object" });
        return;
      }
      const ff = f as Partial<CustomToolField>;
      if (typeof ff.envVar !== "string" || !ENV_VAR_RE.test(ff.envVar)) {
        res.status(400).json({ ok: false, error: `invalid env var: ${String(ff.envVar)}` });
        return;
      }
      const type = ff.type === "text" ? "text" : "password";
      cleanFields.push({
        id: typeof ff.id === "string" && ff.id ? ff.id : ff.envVar.toLowerCase(),
        label: typeof ff.label === "string" && ff.label ? ff.label : ff.envVar,
        envVar: ff.envVar,
        type,
        placeholder: typeof ff.placeholder === "string" ? ff.placeholder : undefined,
      });
    }

    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: CustomToolEntry = {
      id,
      name,
      scope: typeof body.scope === "string" ? body.scope : "Custom credential",
      docsUrl: typeof body.docsUrl === "string" ? body.docsUrl : undefined,
      fields: cleanFields,
      mcp: undefined,
      createdAt: new Date().toISOString(),
    };

    // Optional: also register the tool as an MCP server in .mcp.json. We
    // delegate to the same validation + write path used by /api/mcp/add so
    // a tool with an MCP server is wired up in one shot.
    let mcpResult: { ok: boolean; committed?: boolean; pushed?: boolean; commit?: string | null; error?: string } | null = null;
    if (body.mcp && typeof body.mcp === "object") {
      const m = body.mcp as { name?: unknown; spec?: unknown };
      const mcpName = typeof m.name === "string" ? m.name.trim() : "";
      if (!MCP_NAME_RE.test(mcpName)) {
        res.status(400).json({ ok: false, error: "mcp.name must be alphanumeric/hyphen/underscore (≤64 chars)" });
        return;
      }
      const validation = validateServerSpec(m.spec);
      if (!validation.ok) {
        res.status(400).json({ ok: false, error: `mcp.spec invalid: ${validation.error}` });
        return;
      }
      let cfg: { mcpServers: Record<string, unknown> };
      try { cfg = readMcpConfig(); }
      catch (err) { res.status(500).json({ ok: false, error: `read .mcp.json: ${String(err)}` }); return; }
      if (Object.prototype.hasOwnProperty.call(cfg.mcpServers, mcpName)) {
        res.status(409).json({ ok: false, error: `MCP '${mcpName}' already exists in .mcp.json — pick a different name` });
        return;
      }
      cfg.mcpServers[mcpName] = m.spec as Record<string, unknown>;
      try { writeMcpConfig(cfg); }
      catch (err) { res.status(500).json({ ok: false, error: `write .mcp.json: ${String(err)}` }); return; }
      const git = await gitCommitMcpChange("add", mcpName);
      mcpResult = {
        ok: git.committed && git.pushed,
        committed: git.committed,
        pushed: git.pushed,
        commit: git.sha,
      };
      entry.mcp = { name: mcpName, spec: m.spec as Record<string, unknown> };
    }

    const all = readToolsRegistry();
    all.push(entry);
    try { writeToolsRegistry(all); }
    catch (err) {
      res.status(500).json({ ok: false, error: `failed to persist registry: ${String(err)}` });
      return;
    }

    res.json({ ok: true, entry, mcp: mcpResult });
  });

  app.delete("/api/tools/:id", async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "id is required" });
      return;
    }
    const all = readToolsRegistry();
    const idx = all.findIndex(e => e.id === id);
    if (idx === -1) {
      res.status(404).json({ ok: false, error: `tool '${id}' not found in registry` });
      return;
    }
    const removed = all.splice(idx, 1)[0];

    // If this tool registered an MCP server, also remove it from .mcp.json
    // so the cleanup is symmetric.
    let mcpResult: { ok: boolean; committed?: boolean; pushed?: boolean; commit?: string | null } | null = null;
    if (removed.mcp?.name) {
      try {
        const cfg = readMcpConfig();
        if (Object.prototype.hasOwnProperty.call(cfg.mcpServers, removed.mcp.name)) {
          delete cfg.mcpServers[removed.mcp.name];
          writeMcpConfig(cfg);
          const git = await gitCommitMcpChange("remove", removed.mcp.name);
          mcpResult = {
            ok: git.committed && git.pushed,
            committed: git.committed,
            pushed: git.pushed,
            commit: git.sha,
          };
        }
      } catch (err) {
        // Non-fatal: tool registry update succeeds even if MCP cleanup fails.
        mcpResult = { ok: false };
        console.error("mcp cleanup on tool delete failed:", err);
      }
    }

    try { writeToolsRegistry(all); }
    catch (err) {
      res.status(500).json({ ok: false, error: `failed to persist registry: ${String(err)}` });
      return;
    }

    res.json({ ok: true, removed: removed.id, mcp: mcpResult });
  });

  // Agents API — lists available CLI-based coding agents and whether each is
  // ready to use. listAgentAvailability checks both env var presence and CLI
  // presence on PATH (cached 5s), so the picker can grey out adapters whose
  // binary isn't installed instead of letting a turn fail at spawn time.
  app.get("/api/agents", (req, res) => {
    if (req.query.refresh === "1") clearAgentAuthCache();
    res.json({ agents: listAgentAvailability() });
  });

  // Memory API — exposes auto-memory index so chat can show "what's loaded"
  app.get("/api/memory/index", (_req, res) => {
    try {
      const memDirs = existingMemoryDirs();
      if (memDirs.length === 0) {
        res.json({ entries: [], indexContent: "", dir: MEMORY_DIR, dirs: MEMORY_DIRS });
        return;
      }

      const indexContents = memDirs
        .map(dir => {
          const indexPath = path.join(dir, "MEMORY.md");
          return fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "";
        })
        .filter(Boolean);
      const indexContent = indexContents.join("\n\n");

      const entries: Array<{
        file: string;
        name: string;
        description: string;
        type: string;
        updatedAt: number;
        preview: string;
      }> = [];

      const seen = new Set<string>();
      for (const memDir of memDirs) {
        for (const f of fs.readdirSync(memDir)) {
          if (f === "MEMORY.md" || !f.endsWith(".md") || seen.has(f)) continue;
          seen.add(f);
          try {
            const full = path.join(memDir, f);
            const stat = fs.statSync(full);
            const raw = fs.readFileSync(full, "utf-8");

            // Parse frontmatter between --- blocks
            const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            const fm = fmMatch?.[1] || "";
            const body = fmMatch?.[2] || raw;

            const nameMatch = fm.match(/^name:\s*(.+)$/m);
            const descMatch = fm.match(/^description:\s*(.+)$/m);
            const typeMatch = fm.match(/^type:\s*(\w+)/m);

            const preview = body.trim().slice(0, 240);
            entries.push({
              file: f,
              name: nameMatch?.[1]?.trim() || f.replace(/\.md$/, ""),
              description: descMatch?.[1]?.trim() || "",
              type: typeMatch?.[1]?.trim() || "memory",
              updatedAt: stat.mtimeMs,
              preview,
            });
          } catch { /* skip unreadable files */ }
        }
      }

      // Most recent first
      entries.sort((a, b) => b.updatedAt - a.updatedAt);

      res.json({ entries, indexContent, dir: memDirs[0], dirs: memDirs });
    } catch (err) {
      res.status(500).json({ error: String(err), entries: [] });
    }
  });

  // Memory API — read full content of a specific memory file
  app.get("/api/memory/file", (req, res) => {
    try {
      const name = (req.query.name as string) || "";
      // Only allow bare filenames, no slashes
      if (!name || name.includes("/") || name.includes("..") || !name.endsWith(".md")) {
        res.status(400).json({ error: "Invalid memory file name" });
        return;
      }
      const full = findMemoryFile(name);
      if (!full || !fs.existsSync(full)) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const content = fs.readFileSync(full, "utf-8");
      res.json({ name, content });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Memory health — surfaces both the supervised MCP sidecar state AND the
  // last write to Supabase memories for this workspace. Lets the UI show a
  // visible "memory: ok / 2d stale / down" badge so silent rot stops being
  // possible (the April 28 bug where nothing wrote for 5 days).
  app.get("/api/memory/health", async (_req, res) => {
    try {
      const sidecars = mcpSupervisor.status();
      const memorySidecar = sidecars.find(s => s.name === "janus-memory") ?? null;
      const supabase = await memoryHealthSnapshot(WORKSPACE_NAME);
      res.json({
        sidecar: memorySidecar,
        supabase,
        workspace: WORKSPACE_NAME,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Manual capture — lets the user / a button in the UI force a session
  // summary write right now. Useful for closing the historical gap from
  // April 30 → today, and as an "I'm wrapping up, save what we did" action.
  app.post("/api/memory/capture-now", async (req, res) => {
    try {
      const { sessionId, conversationLog, decisions, learnings, nextSteps, filesChanged, toolsUsed } = (req.body || {}) as {
        sessionId?: string;
        conversationLog?: string[];
        decisions?: string[];
        learnings?: string[];
        nextSteps?: string[];
        filesChanged?: string[];
        toolsUsed?: string[];
      };
      const r = await captureSessionSummary({
        workspace: WORKSPACE_NAME,
        sessionId,
        conversationLog: Array.isArray(conversationLog) ? conversationLog : [],
        decisions, learnings, nextSteps, filesChanged, toolsUsed,
      });
      res.status(r.ok ? 200 : 502).json(r);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Session API — expose persisted dashboard-session state (so frontend can show continuity)
  app.get("/api/session/:id", (req, res) => {
    try {
      const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const file = path.join(JANUS_STATE_DIR, "dashboard-sessions", `${id}.json`);
      const legacyFile = path.join(LEGACY_CLAUDE_STATE_DIR, "dashboard-sessions", `${id}.json`);
      const source = fs.existsSync(file) ? file : legacyFile;
      if (!fs.existsSync(source)) {
        res.json({ persisted: false });
        return;
      }
      const data = JSON.parse(fs.readFileSync(source, "utf-8"));
      const activeAgentId = data.activeAgentId || data.agentId || "claude";
      const engineSessionIds = data.engineSessionIds || (data.claudeSessionId ? { claude: data.claudeSessionId } : {});
      res.json({
        persisted: true,
        activeAgentId,
        engineSessionId: engineSessionIds[activeAgentId] || null,
        claudeSessionId: data.claudeSessionId || engineSessionIds.claude || null,
        updatedAt: data.updatedAt || 0,
        turnCount: Array.isArray(data.conversationLog) ? data.conversationLog.length : 0,
      });
    } catch {
      res.json({ persisted: false });
    }
  });

  // Chat file upload — stores files under dump/uploads/ so the active engine can consume them
  app.post("/api/chat/upload", (req, res) => {
    try {
      const { name, type, data } = (req.body || {}) as { name?: string; type?: string; data?: string };
      if (!name || typeof data !== "string") {
        res.status(400).json({ ok: false, error: "Missing name or data" });
        return;
      }
      const clean = safeFileName(name);
      const filename = `${Date.now()}-${clean}`;
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const full = path.join(UPLOADS_DIR, filename);
      // Accept either base64 ("data:...;base64,XXX" or bare base64) or plain text
      let buf: Buffer;
      if (data.startsWith("data:")) {
        const commaIdx = data.indexOf(",");
        buf = Buffer.from(data.slice(commaIdx + 1), "base64");
      } else {
        // Heuristic: if it decodes cleanly as base64 assume base64, else treat as text
        try { buf = Buffer.from(data, "base64"); if (buf.length === 0) throw new Error(); }
        catch { buf = Buffer.from(data, "utf-8"); }
      }
      fs.writeFileSync(full, buf);
      // Mirror to Google Drive under Janus_AI/_uploads/<YYYY-MM-DD>/ — async, never blocks.
      // Skipped silently if GOOGLE_REFRESH_TOKEN is missing. Local path is authoritative.
      if (process.env.GOOGLE_REFRESH_TOKEN) {
        const child = spawn(path.join(DASH_HOME, "scripts", "gdrive-save"), [full], {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
        let stderr = "";
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", (e) => console.error("[gdrive-save] spawn failed:", e.message));
        child.on("exit", (code) => {
          if (code !== 0) console.error(`[gdrive-save] exit ${code} for ${filename}:`, stderr.trim());
        });
      }
      res.json({ ok: true, path: full, filename, size: buf.length, type: type || "" });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Custom theme extraction — runs `claude -p` with a locked JSON-response prompt
  // against uploaded brand assets and saves the result as a named theme preset.
  app.post("/api/theme/extract", async (req, res) => {
    try {
      const { paths, hint } = (req.body || {}) as { paths?: string[]; hint?: string };
      if (!Array.isArray(paths) || paths.length === 0) {
        res.status(400).json({ ok: false, error: "No file paths provided" });
        return;
      }
      // Basic path safety: must live under the uploads dir
      for (const p of paths) {
        if (typeof p !== "string" || !p.startsWith(UPLOADS_DIR)) {
          res.status(400).json({ ok: false, error: `Invalid path: ${p}` });
          return;
        }
      }

      const fileList = paths.map(p => `- ${p}`).join("\n");
      const prompt = `You are a brand-to-theme extractor. Analyse the attached asset(s) and return ONLY a single JSON object — no prose, no code fence, no markdown.

Files:
${fileList}
${hint ? `\nHint from user: ${hint}` : ""}

Use the Read tool to open each file. For images: identify the dominant brand color and a complementary accent. For PDFs/docs: extract any brand color hexes or explicit guidelines. For screenshots: read the chrome/background vs accent contrast.

Return exactly this shape:
{
  "name": "<short 1–3 word theme name based on brand>",
  "mode": "light" | "dark",
  "primaryHue": <number 0–360>,
  "accentHue": <number 0–360>,
  "chroma": <number 0.05–0.25>,
  "rationale": "<one sentence on why you picked these>"
}

Do not include anything except the JSON object.`;

      const { spawn } = await import("node:child_process");
      const cleanEnv = { ...process.env };
      if (getClaudeSubscriptionAuthStatus().present) delete cleanEnv.ANTHROPIC_API_KEY;
      const proc = spawn(
        "claude",
        ["-p", prompt, "--output-format", "text", "--dangerously-skip-permissions", "--disable-slash-commands"],
        { cwd: WORKSPACE_ROOT, env: cleanEnv },
      );
      let stdout = "", stderr = "";
      proc.stdout?.on("data", d => { stdout += d.toString(); });
      proc.stderr?.on("data", d => { stderr += d.toString(); });
      const exitCode: number = await new Promise(resolve => {
        const timer = setTimeout(() => { proc.kill("SIGTERM"); resolve(124); }, 90_000);
        proc.on("close", code => { clearTimeout(timer); resolve(code ?? 1); });
      });
      if (exitCode !== 0) {
        res.status(502).json({ ok: false, error: `claude exited ${exitCode}: ${stderr.slice(0, 500)}` });
        return;
      }
      // Extract first top-level JSON object from stdout
      const match = stdout.match(/\{[\s\S]*\}/);
      if (!match) { res.status(502).json({ ok: false, error: "No JSON in model output", raw: stdout.slice(0, 500) }); return; }
      let spec: { name?: string; mode?: string; primaryHue?: number; accentHue?: number; chroma?: number; rationale?: string };
      try { spec = JSON.parse(match[0]); } catch { res.status(502).json({ ok: false, error: "Malformed JSON", raw: match[0].slice(0, 500) }); return; }
      // Validate + clamp
      const name = typeof spec.name === "string" && spec.name.trim() ? spec.name.trim().slice(0, 30) : "Custom";
      const mode: "light" | "dark" = spec.mode === "light" ? "light" : "dark";
      const primaryHue = Math.max(0, Math.min(360, Number(spec.primaryHue) || 240));
      const accentHue = Math.max(0, Math.min(360, Number(spec.accentHue) || primaryHue));
      const chroma = Math.max(0.05, Math.min(0.25, Number(spec.chroma) || 0.14));

      const id = `custom-${Date.now().toString(36)}`;
      const theme = { id, name, mode, primaryHue, accentHue, chroma, rationale: spec.rationale || "", createdAt: Date.now() };
      fs.mkdirSync(THEMES_DIR, { recursive: true });
      fs.writeFileSync(path.join(THEMES_DIR, `${id}.json`), JSON.stringify(theme, null, 2));
      res.json({ ok: true, theme });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // List custom themes — frontend merges these into the theme picker
  app.get("/api/theme/custom", (_req, res) => {
    try {
      const themeDirs = [THEMES_DIR, LEGACY_THEMES_DIR].filter(dir => fs.existsSync(dir));
      if (themeDirs.length === 0) { res.json({ themes: [] }); return; }
      const themes: unknown[] = [];
      const seenThemes = new Set<string>();
      for (const themeDir of themeDirs) {
        for (const f of fs.readdirSync(themeDir)) {
          if (!f.endsWith(".json") || seenThemes.has(f)) continue;
          seenThemes.add(f);
          try { themes.push(JSON.parse(fs.readFileSync(path.join(themeDir, f), "utf-8"))); } catch {}
        }
      }
      res.json({ themes });
    } catch (err) {
      res.status(500).json({ themes: [], error: String(err) });
    }
  });

  // Hook receiver — broadcasts tool events to all WS clients
  app.post("/hooks/post-tool-use", (req, res) => {
    const { tool_name, tool_input, session_id } = req.body;
    broadcast({
      type: "tool_event",
      toolName: tool_name || "unknown",
      input: tool_input || {},
      sessionId: session_id || "",
      timestamp: Date.now(),
    });
    res.json({});
  });

  // SPA fallback — serve index.html for non-API routes (Express 5 syntax)
  if (fs.existsSync(frontendDist)) {
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  const server = http.createServer(app);
  // noServer: auth.bindWs handles the upgrade event so it can validate the
  // session cookie before letting the WS through. When auth is disabled the
  // bindWs handler still wires the same upgrade pass-through.
  const wss = new WebSocketServer({ noServer: true });
  auth.bindWs(server, wss);

  // One SessionManager per bridge process, not per WS connection. This lets
  // Engine child processes survive browser blips / tab reloads / Codespaces
  // forwarded-port recycling: the WS detaches cleanly, the CLI keeps running,
  // and the new connection re-attaches without losing the turn.
  const sessionManager = new SessionManager();

  function broadcast(data: ServerMessage): void {
    const payload = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  wss.on("connection", (ws) => {
    console.log("[ws] client connected");

    // Send initial learnings to this client
    broadcastInitialLearnings((msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    // Send the bridge's current project list to this newly-connected client
    // straight from the in-memory cache — no GitHub round-trip, and it's sent
    // every time regardless of whether the list changed since the previous
    // broadcast (the unconditional cache-skip in broadcastInitialProjectStates
    // would otherwise silently drop the message for any tab that connects
    // after the first one).
    sendProjectsSnapshot((msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    // Replay the latest scheduler output too, so the calendar isn't blank
    // until the next 5-min discovery refresh.
    sendCalendarSnapshot((msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    // Same pattern for Jira tickets — populate the panel instantly from cache.
    sendTicketsSnapshot((msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    // Same pattern for Talend jobs.
    sendTalendSnapshot((msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });

    // Background re-pull from GitHub for *this* connection, so any changes the
    // user just made (merged a STATUS.md PR, edited a status file directly on
    // GitHub, created a new repo) surface within seconds of opening a tab —
    // no manual "Refresh discovery" button needed. Cached snapshot above is
    // already on-screen; this updates it in place when fresh data lands.
    broadcastInitialProjectStates(broadcast).catch((e) =>
      console.error("[project-state] background refresh failed:", e?.message ?? e),
    );

    // Re-target existing sessions at the new WS and flush any queued output.
    sessionManager.attachWs(ws);

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" } satisfies ServerMessage));
        return;
      }

      if (!isValidClientMessage(parsed)) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message shape" } satisfies ServerMessage));
        return;
      }

      const msg: ClientMessage = parsed;
      const sid = ('sessionId' in msg ? msg.sessionId : undefined) || "session-0";

      switch (msg.type) {
        case "start": {
          const agentId = (msg.agentId as string | undefined) || "claude";
          const modelId = msg.modelId as string | undefined;
          console.log(`[ws:${sid}/${agentId}] session start requested:`, msg.prompt.slice(0, 80));
          let session = sessionManager.getSession(sid);
          if (session) {
            // Switch agent if needed — otherwise close+recreate only if agent actually changed
            if (session.getAgent() !== agentId) session.setAgent(agentId);
            else session.close();
          } else {
            session = sessionManager.createSession(sid, agentId);
          }
          if (modelId) session.setModel(modelId);
          session.start(msg.prompt, msg.cwd || WORKSPACE_ROOT).catch((err) => {
            console.error(`[ws:${sid}] session error:`, err);
          });
          break;
        }
        case "follow_up": {
          const agentId = (msg.agentId as string | undefined);
          const modelId = msg.modelId as string | undefined;
          console.log(`[ws:${sid}] follow-up requested:`, msg.prompt.slice(0, 80));
          const session = sessionManager.getSession(sid);
          if (session) {
            if (agentId && session.getAgent() !== agentId) session.setAgent(agentId);
            if (modelId) session.setModel(modelId);
            session.followUp(msg.prompt).catch((err) => {
              console.error(`[ws:${sid}] follow-up error:`, err);
            });
          }
          break;
        }
        case "set_agent": {
          const session = sessionManager.getSession(sid);
          if (session) {
            session.setAgent(msg.agentId);
            if (msg.modelId) session.setModel(msg.modelId);
          }
          break;
        }
        case "set_model": {
          const session = sessionManager.getSession(sid);
          if (session) session.setModel(msg.modelId);
          break;
        }
        case "permission_response": {
          console.log(`[ws:${sid}] permission response:`, msg.id, msg.allowed);
          // Permission handling is per-session now via the session's own manager
          break;
        }
        case "interrupt": {
          console.log(`[ws:${sid}] interrupt requested`);
          const session = sessionManager.getSession(sid);
          if (session) {
            session.interrupt().catch((err) => {
              console.error(`[ws:${sid}] interrupt error:`, err);
            });
          }
          break;
        }
        case "fork": {
          console.log(`[ws] fork requested: ${msg.parentSessionId} -> ${msg.newSessionId} (${msg.forkLabel})`);
          const forked = sessionManager.forkSession(
            msg.parentSessionId, msg.newSessionId, msg.forkLabel, msg.forkMessageIndex
          );
          if (forked) {
            const forkedAdapter = getAgent(forked.getAgent());
            // Send session_start for the new session
            ws.send(JSON.stringify({
              type: "session_start",
              auth: forkedAdapter.authMethod === "oauth" ? "subscription" : "api_key",
              sessionId: msg.newSessionId,
            } satisfies ServerMessage));
          }
          break;
        }
        case "restart_session": {
          // Drop the engine session entirely; the next "start" message on
          // this same sessionId will recreate it from scratch (the start
          // handler already does close+recreate when appropriate). Frontend
          // owns the visible state reset (messages, input, attachments).
          console.log(`[ws:${msg.sessionId}] restart requested — closing engine session`);
          sessionManager.closeSession(msg.sessionId);
          break;
        }
      }
    });

    ws.on("close", () => {
      console.log("[ws] client disconnected — sessions keep running, output queues");
      // Detach ONLY this WS from the broadcast set. Sessions stay alive.
      // Other open tabs continue receiving. If this was the last tab, the
      // session's output queues until a new client reconnects.
      sessionManager.detachWs(ws);
    });
  });

  // Graceful shutdown
  let watchers: FSWatcher[] = [];
  function shutdown() {
    console.log("\n[bridge] shutting down...");
    stopWatchers(watchers).catch(() => {});
    const t = (server as unknown as { _projectRefresh?: NodeJS.Timeout })._projectRefresh;
    if (t) clearInterval(t);
    const ws = (server as unknown as { _wikiSync?: NodeJS.Timeout })._wikiSync;
    if (ws) clearInterval(ws);
    const jp = (server as unknown as { _jiraPoll?: NodeJS.Timeout })._jiraPoll;
    if (jp) clearInterval(jp);
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Export broadcast for use by other modules
  (server as any).broadcast = broadcast;
  (server as any).wss = wss;

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[bridge] listening on port ${port}`);
      watchers = startWatchers(broadcast);
      broadcastInitialLearnings(broadcast);
      ensureHookConfig(port);

      // Live project cards: initial fetch + 5-min refresh + per-wiki-change.
      // Initial discovery, then sync every wiki to its repo's .janus/status.md,
      // then a final discovery pass so the dashboard reads the freshly-synced
      // status files. The sync is idempotent (skips repos whose status content
      // already matches what's generated), so this no-ops on subsequent boots.
      broadcastInitialProjectStates(broadcast)
        .then(() => syncAllWikis(discoveredReposForSync()))
        .then(() => broadcastInitialProjectStates(broadcast))
        .catch((e) => console.error("[project-state] initial fetch/sync failed:", e?.message ?? e));
      const projRefresh = startProjectStateRefresh(broadcast);
      (server as unknown as { _projectRefresh?: NodeJS.Timeout })._projectRefresh = projRefresh;

      // Wiki ↔ status sync on a 5-min cadence. Independent of discovery so
      // wiki edits get pushed to repos even if the discovery list is unchanged.
      const wikiSyncTimer = setInterval(() => {
        syncAllWikis(discoveredReposForSync())
          .then(() => broadcastInitialProjectStates(broadcast))
          .catch((e) => console.error("[wiki-sync] periodic run failed:", e?.message ?? e));
      }, 5 * 60 * 1000);
      (server as unknown as { _wikiSync?: NodeJS.Timeout })._wikiSync = wikiSyncTimer;

      // Jira polling: kicks off immediately + every 2 min.
      const jiraTimer = startJiraPolling(broadcast);
      (server as unknown as { _jiraPoll?: NodeJS.Timeout })._jiraPoll = jiraTimer;

      // Talend polling: same cadence.
      const talendTimer = startTalendPolling(broadcast);
      (server as unknown as { _talendPoll?: NodeJS.Timeout })._talendPoll = talendTimer;

      // Hook the existing vault watcher: when a wiki/<project>.md changes,
      // (a) re-broadcast the corresponding project card, AND (b) push the
      // updated wiki content to the matching repo's .janus/status.md so the
      // user's edit shows up everywhere within seconds.
      if (watchers[0]) {
        watchers[0].on("change", (filePath: string) => {
          const slug = wikiSlugFromPath(filePath);
          if (slug) refreshOneProject(broadcast, slug).catch(() => {});
          if (filePath.match(/\/wiki\/[^/]+\.md$/)) {
            const wikiName = filePath.replace(/.*\/wiki\//, "");
            syncOneWiki(wikiName, discoveredReposForSync())
              .then((r) => {
                if (r.result === "committed-new" || r.result === "committed-updated") {
                  // Pull fresh content into the dashboard immediately.
                  broadcastInitialProjectStates(broadcast).catch(() => {});
                }
              })
              .catch((e) => console.error("[wiki-sync] on-change failed:", e?.message ?? e));
          }
        });
      }

      resolve(server);
    });
  });
}

interface GraphNode {
  id: string;
  label: string;
  group: string;
  links: string[];
}

// Build a graph from brain_events rows. Nodes: one per tool_name (agents group),
// one per project (wiki group), one per workspace (concepts group). Edges:
// tool↔project and tool↔workspace when they co-occur in the log.
function buildUsageGraph(
  rows: Array<{ tool_name: string; workspace: string | null; project: string | null; status: string; created_at: string }>,
): { nodes: GraphNode[]; edges: { source: string; target: string }[] } {
  const toolCounts = new Map<string, number>();
  const projCounts = new Map<string, number>();
  const wsCounts = new Map<string, number>();
  const pairs = new Set<string>(); // "src|tgt"

  for (const r of rows) {
    const tool = r.tool_name;
    const toolId = `u-tool-${tool}`;
    toolCounts.set(toolId, (toolCounts.get(toolId) ?? 0) + 1);

    if (r.project) {
      const projId = `u-proj-${r.project}`;
      projCounts.set(projId, (projCounts.get(projId) ?? 0) + 1);
      pairs.add(`${toolId}|${projId}`);
    }
    if (r.workspace) {
      const wsId = `u-ws-${r.workspace}`;
      wsCounts.set(wsId, (wsCounts.get(wsId) ?? 0) + 1);
      pairs.add(`${toolId}|${wsId}`);
    }
  }

  const nodes: GraphNode[] = [];
  const outgoing = new Map<string, string[]>(); // node → links

  for (const [id] of toolCounts) {
    outgoing.set(id, []);
  }
  for (const [id] of projCounts) {
    outgoing.set(id, []);
  }
  for (const [id] of wsCounts) {
    outgoing.set(id, []);
  }

  const edges: { source: string; target: string }[] = [];
  for (const p of pairs) {
    const [src, tgt] = p.split("|");
    edges.push({ source: src, target: tgt });
    outgoing.get(src)?.push(tgt);
    outgoing.get(tgt)?.push(src);
  }

  // Renderer sizes nodes by links.length. Pad the links array with repeats of
  // the first real link so heavily-used nodes render bigger — does not affect
  // the separate edges array the renderer draws.
  const pad = (base: string[], extra: number) =>
    extra <= 0 || base.length === 0 ? base : [...base, ...Array(Math.min(extra, 20)).fill(base[0])];

  const pushBy = (counts: Map<string, number>, prefix: string, group: string) => {
    for (const [id, count] of counts) {
      const base = outgoing.get(id) ?? [];
      nodes.push({ id, label: id.replace(prefix, ""), group, links: pad(base, count - 1) });
    }
  };
  pushBy(toolCounts, "u-tool-", "agents");
  pushBy(projCounts, "u-proj-", "wiki");
  pushBy(wsCounts, "u-ws-", "concepts");

  return { nodes, edges };
}

function buildGraphFromFs(): { nodes: GraphNode[]; edges: { source: string; target: string }[] } {
  const root = WORKSPACE_ROOT;
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();

  function addNode(id: string, label: string, group: string, links: string[]) {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, group, links });
  }

  // Scan agents
  const agentsDir = path.join(root, "agents", "core");
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith(".md")) {
        const name = f.replace(".md", "");
        addNode(`a-${name}`, name, "agents", []);
      }
    }
  }
  const domainDir = path.join(root, "agents", "domain");
  if (fs.existsSync(domainDir)) {
    for (const f of fs.readdirSync(domainDir)) {
      if (f.endsWith(".md")) {
        const name = f.replace(".md", "");
        addNode(`a-${name}`, name, "agents", []);
      }
    }
  }

  // Scan projects from PROJECTS.md or projects/ dirs
  for (const stage of ["dev", "uat", "prod"]) {
    const dir = path.join(root, "projects", stage);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".md")) {
          const name = f.replace(".md", "");
          const links = [`a-developer`];
          addNode(`w-${name}`, name, "wiki", links);
        }
      }
    }
  }

  // Scan learnings
  const learningsDir = path.join(root, "learnings");
  if (fs.existsSync(learningsDir)) {
    for (const f of fs.readdirSync(learningsDir)) {
      if (f.endsWith(".md")) {
        const name = f.replace(".md", "");
        addNode(`l-${name}`, name, "learnings", []);
      }
    }
  }

  // Scan concepts
  const conceptsDir = path.join(root, "concepts");
  if (fs.existsSync(conceptsDir)) {
    for (const f of fs.readdirSync(conceptsDir)) {
      if (f.endsWith(".md")) {
        const name = f.replace(".md", "");
        addNode(`c-${name}`, name, "concepts", []);
      }
    }
  }

  // Scan memory files (persistent learnings)
  const memoryDirs = existingMemoryDirs();
  const scannedMemory = new Set<string>();
  for (const memoryDir of memoryDirs) {
    for (const f of fs.readdirSync(memoryDir)) {
      if (f === "MEMORY.md" || !f.endsWith(".md") || scannedMemory.has(f)) continue;
      scannedMemory.add(f);
      const name = f.replace(".md", "");
      try {
        const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
        // Parse frontmatter
        const typeMatch = content.match(/^type:\s*(\w+)/m);
        const nameMatch = content.match(/^name:\s*(.+)/m);
        const descMatch = content.match(/^description:\s*(.+)/m);
        const memType = typeMatch?.[1] || "memory";
        const group = memType === "feedback" ? "learnings"
          : memType === "user" ? "concepts"
          : memType === "project" ? "wiki"
          : memType === "reference" ? "learnings"
          : "learnings";

        // Use frontmatter for the label — prefer description for sessions, name for others
        const rawName = nameMatch?.[1]?.trim() || "";
        const desc = descMatch?.[1]?.trim() || "";
        const isSessionSlug = /^[Ss]ession.20\d{2}/.test(rawName) || rawName.startsWith("session_");
        let label = (isSessionSlug && desc) ? desc : (rawName || desc || name.replace(/_/g, " "));
        // Truncate long labels for readability
        if (label.length > 50) label = label.slice(0, 47) + "...";

        // Auto-link to projects/concepts mentioned in content
        const links: string[] = [];
        const lc = content.toLowerCase();
        for (const n of nodes) {
          if (n.group === "wiki" && lc.includes(n.label.toLowerCase())) {
            links.push(n.id);
          }
        }
        // Link feedback/user memories to relevant agents
        if (memType === "feedback" && lc.includes("ui")) links.push("a-ux");
        if (memType === "feedback" && lc.includes("deploy")) links.push("a-deploy");
        if (lc.includes("legal") || lc.includes("compliance")) links.push("a-legal");
        if (lc.includes("security")) links.push("a-security");
        if (lc.includes("supabase")) links.push("c-supabase-shared");
        if (lc.includes("playwright")) links.push("a-ux");

        addNode(`m-${name}`, label, group, links.filter(l => seen.has(l)));
      } catch { /* skip */ }
    }
  }

  // Parse [[links]] from files to build edges
  for (const n of nodes) {
    const labelFile = n.label.replace(/ /g, "_") + ".md";
    const possiblePaths = [
      path.join(root, "agents", "core", `${n.label}.md`),
      path.join(root, "agents", "domain", `${n.label}.md`),
      path.join(root, "learnings", `${n.label}.md`),
      path.join(root, "concepts", `${n.label}.md`),
      ...memoryDirs.map(memoryDir => path.join(memoryDir, labelFile)),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, "utf-8");
          const wikiLinks = content.match(/\[\[([^\]]+)\]\]/g) || [];
          for (const link of wikiLinks) {
            const target = link.slice(2, -2).split("/").pop() || "";
            // Try to match to an existing node
            const match = nodes.find(
              nn => nn.label === target || nn.id === target || nn.label === target.replace(/-/g, " ")
            );
            if (match && match.id !== n.id && !n.links.includes(match.id)) {
              n.links.push(match.id);
            }
          }
        } catch { /* skip unreadable files */ }
        break;
      }
    }
  }

  // Build edges from links
  const edges: { source: string; target: string }[] = [];
  const edgeSet = new Set<string>();
  for (const n of nodes) {
    for (const t of n.links) {
      const key = [n.id, t].sort().join("--");
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: n.id, target: t });
      }
    }
  }

  return { nodes, edges };
}

function ensureHookConfig(port: number): void {
  const configDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude");
  const configPath = path.join(configDir, "settings.json");
  const hookUrl = `http://localhost:${port}/hooks/post-tool-use`;

  const desired = {
    hooks: {
      PostToolUse: [
        {
          matcher: "",
          hooks: [{ type: "http", url: hookUrl }],
        },
      ],
    },
  };

  try {
    if (fs.existsSync(configPath)) {
      const existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const existingUrl = existing?.hooks?.PostToolUse?.[0]?.hooks?.[0]?.url;
      if (existingUrl === hookUrl) return;
    }
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(desired, null, 2) + "\n");
    console.log(`[bridge] hook config written to ${configPath}`);
  } catch (err) {
    console.warn("[bridge] failed to write hook config:", err);
  }
}
