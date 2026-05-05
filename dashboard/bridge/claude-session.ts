import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { WebSocket } from "ws";
import type { ServerMessage } from "./types.js";
import { getAgent, getAgentAvailability, listAgentAvailability, markAgentAuthFailure } from "./agent-registry.js";
import { workspaceStateSlug } from "./path-utils.js";
import { captureSessionSummary } from "./memory-capture.js";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/workspaces/janus-ia";
const ENGINE_PROJECT_DIR = workspaceStateSlug(WORKSPACE_ROOT);
const JANUS_STATE_DIR = path.join(os.homedir(), ".janus", "projects", ENGINE_PROJECT_DIR);
const LEGACY_CLAUDE_STATE_DIR = path.join(os.homedir(), ".claude", "projects", ENGINE_PROJECT_DIR);
const SESSIONS_DIR = path.join(JANUS_STATE_DIR, "dashboard-sessions");
const LEGACY_SESSIONS_DIR = path.join(LEGACY_CLAUDE_STATE_DIR, "dashboard-sessions");

const PROJECT_STATUS_FILES = [
  { id: "espacio-bosques", file: "wiki/espacio-bosques.md" },
  { id: "lool-ai", file: "wiki/lool-ai.md" },
  { id: "nutria", file: "wiki/nutria.md" },
  { id: "longevite", file: "wiki/longevite.md" },
  { id: "freelance-system", file: "wiki/freelance-system.md" },
  { id: "jp-ai", file: "wiki/jp-ai.md" },
];

type PersistedSession = {
  sessionId?: string;
  agentId?: string;
  activeAgentId?: string;
  activeModelId?: string;
  claudeSessionId?: string | null;
  engineSessionIds?: Record<string, string | null>;
  engineTurnCounts?: Record<string, number>;
  conversationLog?: string[];
  lastPrompt?: string;
  updatedAt?: number;
};

function isValidCwd(cwd: string): boolean {
  return cwd.startsWith(WORKSPACE_ROOT);
}

function asksForProjectStatus(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const mentionsProjects = /\b(projects?|portfolio|ventures?|janus)\b/.test(p);
  const asksStatus = /\b(status|state|progress|next|priority|priorities|where\s+(things|we|they)\s+stand|what'?s\s+going\s+on)\b/.test(p);
  return mentionsProjects && asksStatus;
}

function extractWikiStatus(raw: string): { status: string | null; nextActions: string[] } {
  const status = raw.match(/##\s+Status\s*\n+([^\n]+)/)?.[1]?.trim() ?? null;
  const nextActions = raw
    .split("\n")
    .filter((line) => /^\s*[-*]\s*⬜/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s*⬜\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return { status, nextActions };
}

function buildProjectStatusContext(): string | null {
  const lines: string[] = [];
  for (const project of PROJECT_STATUS_FILES) {
    const file = path.join(WORKSPACE_ROOT, project.file);
    if (!fs.existsSync(file)) continue;
    const { status, nextActions } = extractWikiStatus(fs.readFileSync(file, "utf-8"));
    if (!status && nextActions.length === 0) continue;
    lines.push(`- ${project.id}: ${status ?? "status not recorded"}`);
    if (nextActions.length > 0) lines.push(`  Next: ${nextActions.join("; ")}`);
  }
  if (lines.length === 0) return null;
  return [
    "[Janus project status context]",
    "The user is asking about current project status. Answer directly from this context, and use PROJECTS.md/wiki files for more detail if needed. Do not answer with a generic readiness acknowledgement.",
    ...lines,
    "[End Janus project status context]",
  ].join("\n");
}

function enrichProjectStatusPrompt(prompt: string): string {
  if (!asksForProjectStatus(prompt)) return prompt;
  const context = buildProjectStatusContext();
  return context ? `${context}\n\n${prompt}` : prompt;
}

function sessionFile(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

function legacySessionFile(sessionId: string, agentId: string = "claude"): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = agentId === "claude" ? "" : `-${agentId}`;
  return path.join(LEGACY_SESSIONS_DIR, `${safe}${suffix}.json`);
}

function readJsonFile(file: string): PersistedSession | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as PersistedSession;
  } catch {
    return null;
  }
}

function readPersistedSession(sessionId: string, agentId: string): PersistedSession | null {
  const primary = readJsonFile(sessionFile(sessionId));
  if (primary) return primary;
  return readJsonFile(legacySessionFile(sessionId, agentId)) || readJsonFile(legacySessionFile(sessionId, "claude"));
}

function loadPersistedSession(sessionId: string, agentId: string = "claude"): {
  engineSessionId: string | null;
  engineTurnCounts: Record<string, number>;
  conversationLog: string[];
} {
  const parsed = readPersistedSession(sessionId, agentId);
  if (!parsed) return { engineSessionId: null, engineTurnCounts: {}, conversationLog: [] };

  const engineSessionIds = parsed.engineSessionIds || {};
  if (parsed.claudeSessionId && !engineSessionIds.claude) {
    engineSessionIds.claude = parsed.claudeSessionId;
  }
  return {
    engineSessionId: typeof engineSessionIds[agentId] === "string" ? engineSessionIds[agentId]! : null,
    engineTurnCounts: parsed.engineTurnCounts && typeof parsed.engineTurnCounts === "object" ? parsed.engineTurnCounts : {},
    conversationLog: Array.isArray(parsed.conversationLog) ? parsed.conversationLog.slice(-80) : [],
  };
}

function persistSession(
  sessionId: string,
  engineSessionId: string | null,
  conversationLog: string[],
  lastPrompt: string,
  agentId: string = "claude",
  modelId?: string,
  options: { markEngineCaughtUp?: boolean } = {},
): void {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const existing = readJsonFile(sessionFile(sessionId)) || {};
    const engineSessionIds: Record<string, string | null> = {
      ...(existing.engineSessionIds || {}),
    };
    if (existing.claudeSessionId && !engineSessionIds.claude) {
      engineSessionIds.claude = existing.claudeSessionId;
    }
    if (engineSessionId) {
      engineSessionIds[agentId] = engineSessionId;
    }
    const engineTurnCounts: Record<string, number> = {
      ...(existing.engineTurnCounts || {}),
    };
    if (options.markEngineCaughtUp) {
      engineTurnCounts[agentId] = conversationLog.length;
    }
    const payload = {
      sessionId,
      activeAgentId: agentId,
      activeModelId: modelId,
      engineSessionIds,
      engineTurnCounts,
      // Backward-compatible field for old UI/session probes.
      claudeSessionId: engineSessionIds.claude || null,
      conversationLog: conversationLog.slice(-50),
      lastPrompt: lastPrompt.slice(0, 500),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(sessionFile(sessionId), JSON.stringify(payload, null, 2));
  } catch (err) {
    console.warn(`[session:${sessionId}] failed to persist:`, err);
  }
}

export class ClaudeSession {
  private process: ChildProcess | null = null;
  private engineSessionId: string | null = null;
  private engineTurnCounts: Record<string, number> = {};
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private conversationLog: string[] = [];
  private forkContext: string[] | null = null;
  private lastPrompt: string = "";
  private agentId: string = "claude";
  private modelId: string;
  private ws: WebSocket | null;
  private manager: { broadcast: (msg: ServerMessage & { sessionId?: string }) => void } | null;
  /** Reset to false at the top of each start(); flipped by any error path so
   * the silent-failure detector in close() can decide whether to also report. */
  private errorSentThisTurn = false;
  /** conversationLog.length at the moment of the most recent Supabase capture.
   * Used to throttle auto-captures to roughly one per `CAPTURE_TURN_INTERVAL`
   * additional turns, plus a final flush when the process exits. */
  private lastCapturedTurnCount = 0;

  constructor(
    ws: WebSocket | null,
    _permissionManager: unknown,
    private sessionId: string = "session-0",
    agentId: string = "claude",
    manager: { broadcast: (msg: ServerMessage & { sessionId?: string }) => void } | null = null,
  ) {
    this.ws = ws;
    this.manager = manager;
    this.agentId = agentId;
    this.modelId = getAgent(agentId).defaultModel;
    const persisted = loadPersistedSession(sessionId, agentId);
    this.engineSessionId = persisted.engineSessionId;
    this.engineTurnCounts = persisted.engineTurnCounts;
    this.conversationLog = persisted.conversationLog;
    if (this.engineSessionId) {
      console.log(`[session:${sessionId}/${agentId}] resumed engine id: ${this.engineSessionId}`);
    }
  }

  /** Swap the active WebSocket target. Called by SessionManager on reconnect. */
  setWs(ws: WebSocket | null): void {
    this.ws = ws;
  }

  /** Switch agents — reloads persisted state for the new agent. Resets model to new agent's default. */
  setAgent(agentId: string): void {
    if (agentId === this.agentId) return;
    this.close();
    const currentLog = this.conversationLog;
    this.agentId = agentId;
    this.modelId = getAgent(agentId).defaultModel;
    const persisted = loadPersistedSession(this.sessionId, agentId);
    this.engineSessionId = persisted.engineSessionId;
    this.engineTurnCounts = persisted.engineTurnCounts;
    this.conversationLog = currentLog.length >= persisted.conversationLog.length
      ? currentLog
      : persisted.conversationLog;
    persistSession(this.sessionId, this.engineSessionId, this.conversationLog, this.lastPrompt, this.agentId, this.modelId);
    console.log(`[session:${this.sessionId}] switched to agent "${agentId}" (model: ${this.modelId})`);
  }

  getAgent(): string { return this.agentId; }

  /** Switch models within the current agent — takes effect on the next turn. */
  setModel(modelId: string): void {
    const adapter = getAgent(this.agentId);
    if (!adapter.models.some(m => m.id === modelId)) {
      console.warn(`[session:${this.sessionId}/${this.agentId}] unknown model "${modelId}" — ignoring`);
      return;
    }
    if (modelId === this.modelId) return;
    this.modelId = modelId;
    console.log(`[session:${this.sessionId}/${this.agentId}] model → ${modelId}`);
  }

  getModel(): string { return this.modelId; }

  /** Whether this engine has a persisted native session id */
  hasPersistedSession(): boolean {
    return this.engineSessionId !== null;
  }

  /** Set conversation history from parent session (for forks) */
  setForkContext(history: string[]): void {
    this.forkContext = history;
  }

  /** Get the accumulated conversation log for forking */
  getConversationLog(): string[] {
    return [...this.conversationLog];
  }

  private buildEngineHandoff(prompt: string): string {
    if (this.conversationLog.length === 0) return prompt;

    const knownCount = this.engineSessionId
      ? (this.engineTurnCounts[this.agentId] ?? 0)
      : 0;
    if (this.engineSessionId && knownCount >= this.conversationLog.length) return prompt;

    const handoffEntries = (this.engineSessionId
      ? this.conversationLog.slice(Math.max(0, knownCount))
      : this.conversationLog
    ).slice(-24);
    if (handoffEntries.length === 0) return prompt;

    let handoff = handoffEntries.join("\n\n");
    const maxChars = 18_000;
    if (handoff.length > maxChars) {
      handoff = handoff.slice(handoff.length - maxChars);
      handoff = `[truncated]\n${handoff}`;
    }

    return [
      "[Janus shared session context]",
      "You are an interchangeable engine inside the same Janus brain. Claude, Codex, and other CLIs are processors, not separate assistants.",
      "The following bridge-level conversation happened before this turn and may include work from a different engine. Preserve continuity and use the same repository, memory, MCP, tool, and vault context.",
      handoff,
      "[End Janus shared session context]",
      "",
      prompt,
    ].join("\n");
  }

  async start(prompt: string, cwd: string): Promise<void> {
    const safeCwd = isValidCwd(cwd) ? cwd : WORKSPACE_ROOT;
    this.close();

    // If this is a forked session, prepend parent context
    let fullPrompt = enrichProjectStatusPrompt(prompt);
    if (this.forkContext && this.forkContext.length > 0) {
      const contextBlock = this.forkContext.join("\n");
      fullPrompt = `[Previous conversation context — you are continuing from a forked branch]\n${contextBlock}\n[End of context. Continue from here.]\n\n${fullPrompt}`;
      this.forkContext = null; // Only use once
    }
    fullPrompt = this.buildEngineHandoff(fullPrompt);

    const adapter = getAgent(this.agentId);
    const availability = getAgentAvailability(this.agentId);
    if (!availability.available) {
      const fallback = listAgentAvailability().find(a => a.available && a.id !== this.agentId);
      if (fallback) {
        const reason = (availability.reason || "auth check failed").replace(/\.+\s*$/, "");
        this.send({
          type: "error",
          message: `${adapter.label} is unavailable: ${reason}. Switching to ${fallback.label}.`,
          sessionId: this.sessionId,
        });
        this.setAgent(fallback.id);
        await this.start(prompt, cwd);
        return;
      }
      this.send({
        type: "error",
        message: availability.reason || `${adapter.label} is not available on this machine.`,
        sessionId: this.sessionId,
      });
      this.send({
        type: "session_end",
        cost: undefined,
        usage: undefined,
        sessionId: this.sessionId,
      });
      return;
    }

    const spawnSpec = adapter.buildSpawn({
      prompt: fullPrompt,
      continueId: this.engineSessionId,
      modelId: this.modelId,
    });

    console.log(`[session:${this.sessionId}/${this.agentId}] spawning ${adapter.cli} (model: ${this.modelId})...`);

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const key of spawnSpec.envUnset || []) { delete childEnv[key]; }
    if (spawnSpec.envPatch) { Object.assign(childEnv, spawnSpec.envPatch); }

    // Pre-flight: missing-credential guard for adapters that strictly need an
    // env key. Codex can also use `codex login`, so env absence is not fatal.
    if (adapter.envVarRequired && adapter.id !== "codex" && !childEnv[adapter.envVarRequired]) {
      this.send({ type: "error", message: `${adapter.label} requires ${adapter.envVarRequired} — open the Key Vault to add it.`, sessionId: this.sessionId });
      this.send({ type: "session_end", cost: undefined, usage: undefined, sessionId: this.sessionId });
      return;
    }

    this.send({
      type: "session_start",
      auth: (spawnSpec.authMethod ?? adapter.authMethod) === "oauth" ? "subscription" : "api_key",
      sessionId: this.sessionId,
    });

    // Log user message
    this.conversationLog.push(`User (${this.agentId}/${this.modelId}): ${prompt}`);
    this.lastPrompt = prompt;
    // Persist immediately so a crash mid-turn doesn't lose the user's message
    persistSession(this.sessionId, this.engineSessionId, this.conversationLog, prompt, this.agentId, this.modelId);

    // Windows + shell:true is required to resolve .cmd / .ps1 npm shims on
    // PATH, but Node's spawn does NOT escape args under shell:true (see
    // DEP0190). cmd.exe then word-splits any unquoted whitespace, so a prompt
    // like "Reply with exactly OK" reaches the CLI as five separate args.
    // Claude tolerates extra positionals; Codex strict-parses and errors with
    // `unexpected argument 'with' found`. Pre-quote per-arg here so the shell
    // sees one token per array entry.
    const winArgs = process.platform === "win32"
      ? spawnSpec.args.map((a) => /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
      : spawnSpec.args;
    // If the adapter wants the prompt piped via stdin (claude/codex do — see
    // AgentSpawn.stdinInput for why), open stdin as a pipe so we can write to
    // it. Otherwise leave it ignored to match the legacy behavior.
    const wantsStdin = typeof spawnSpec.stdinInput === "string";
    const proc = spawn(spawnSpec.cli, winArgs, {
      cwd: safeCwd,
      stdio: [wantsStdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: childEnv,
      shell: process.platform === "win32",
    });

    if (wantsStdin && proc.stdin) {
      proc.stdin.on("error", (err) => {
        // Child may have already exited (auth failure, etc.) — swallow EPIPE
        // and let the close handler surface the actual cause.
        console.warn(`[session:${this.sessionId}/${this.agentId}] stdin write error:`, err.message);
      });
      try {
        proc.stdin.end(spawnSpec.stdinInput!, "utf8");
      } catch (err) {
        console.warn(`[session:${this.sessionId}/${this.agentId}] stdin end error:`, err);
      }
    }

    this.process = proc;
    let buffer = "";
    let assistantBuffer = "";
    // Reset per-turn error flag — handleStreamEvent and stderr both flip it.
    this.errorSentThisTurn = false;
    // Snapshot the resume id we're trying to use this turn — if the process
    // exits silently we'll clear it so the next attempt starts fresh.
    const resumedFrom: string | null = this.engineSessionId;
    const isStreamJson = spawnSpec.outputFormat === "stream-json";
    const isCodexJson = spawnSpec.outputFormat === "codex-json";

    // Safety timeout — if no output for 120s, kill the process
    this.resetTimeout(proc);

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.resetTimeout(proc);
      buffer += chunk.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (isStreamJson) {
          try {
            const event = JSON.parse(trimmed);
            const text = this.handleStreamEvent(event);
            if (text) assistantBuffer += text;
          } catch {
            // Fall through — some lines may be plain text even in stream-json mode
            this.send({ type: "claude_message", message: trimmed, sessionId: this.sessionId });
            assistantBuffer += trimmed;
          }
        } else if (isCodexJson) {
          try {
            const event = JSON.parse(trimmed);
            const text = this.handleCodexEvent(event);
            if (text) assistantBuffer += text;
          } catch {
            /* ignore malformed codex lines */
          }
        } else {
          // Plain-text agent: stream each non-empty line as an assistant message
          this.send({ type: "claude_message", message: trimmed, sessionId: this.sessionId });
          assistantBuffer += trimmed + "\n";
        }
      }
    });

    // Fatal stderr detection — only surface errors that mean the turn is broken.
    // Codex especially logs many non-fatal ERROR lines (shell snapshot validation,
    // debug traces) that would otherwise flood the chat with false alarms.
    // Also detect retry loops (same error repeated) so the CLI doesn't hang
    // forever on auth failures without emitting session_end.
    let lastStderrError = "";
    let stderrErrorCount = 0;
    let stderrErrorWindowStart = 0;
    const FATAL_STDERR_PATTERNS = [
      /\b401\s+Unauthorized\b/i,
      /\b403\s+Forbidden\b/i,
      /authentication.*(failed|required)/i,
      /invalid api key|api key.*invalid/i,
      /\bfatal\b/i,
      /\bpanic(ked)?\b/i,
      /command not found/,
      /permission denied/i,
      /ENOENT|EACCES|ECONNREFUSED/,
    ];
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      console.log(`[session:${this.sessionId}:stderr]`, text);
      const isKnownBenign = [
        /Reading additional input from stdin/i,
        /Shell snapshot validation failed/i,
        /rmcp::transport::streamable_http_client: fail to delete session/i,
      ].some(re => re.test(text));
      if (isKnownBenign) return;
      const isFatal = FATAL_STDERR_PATTERNS.some(re => re.test(text));
      if (!isFatal) return; // informational log — don't promote to chat error

      this.send({ type: "error", message: text, sessionId: this.sessionId });
      this.errorSentThisTurn = true;

      // Retry-loop guard: if the same fatal error repeats 3 times within 5s,
      // the CLI is stuck. Kill it and let close-handler emit session_end.
      const now = Date.now();
      const signature = text.slice(0, 120);
      if (signature === lastStderrError && now - stderrErrorWindowStart < 5_000) {
        stderrErrorCount++;
        if (stderrErrorCount >= 3) {
          console.warn(`[session:${this.sessionId}] killing stuck CLI after ${stderrErrorCount} identical fatal errors`);
          try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        }
      } else {
        lastStderrError = signature;
        stderrErrorWindowStart = now;
        stderrErrorCount = 1;
      }
    });

    proc.on("close", (code) => {
      console.log(`[session:${this.sessionId}/${this.agentId}] process exited with code ${code}`);
      this.clearTimeout();
      this.process = null;

      // Process remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (isStreamJson) {
          try {
            const event = JSON.parse(trimmed);
            const text = this.handleStreamEvent(event);
            if (text) assistantBuffer += text;
          } catch {
            this.send({ type: "claude_message", message: trimmed, sessionId: this.sessionId });
            assistantBuffer += trimmed;
          }
        } else if (isCodexJson) {
          try {
            const event = JSON.parse(trimmed);
            const text = this.handleCodexEvent(event);
            if (text) assistantBuffer += text;
          } catch { /* drop */ }
        } else {
          this.send({ type: "claude_message", message: trimmed, sessionId: this.sessionId });
          assistantBuffer += trimmed;
        }
        buffer = "";
      }

      // Log assistant response
      if (assistantBuffer) {
        this.conversationLog.push(`Assistant (${this.agentId}/${this.modelId}): ${assistantBuffer}`);
      }

      // Silent-failure recovery: process exited with no assistant text and no
      // fatal stderr already surfaced. Most common cause is a stale --resume
      // session id (Claude rejects it but exits 0 with no output). Clear the
      // persisted engine session id so the next attempt spawns fresh, and tell
      // the user what happened so they don't sit watching a dead spinner.
      if (!assistantBuffer.trim() && !this.errorSentThisTurn) {
        const adapterLabel = getAgent(this.agentId).label;
        const usedResume = !!resumedFrom;
        const reason = usedResume
          ? `${adapterLabel} returned no output. The engine's resume id may be stale — clearing it. Send your message again and it will spawn fresh.`
          : `${adapterLabel} exited (code ${code}) with no output. Check the bridge logs for details.`;
        this.send({ type: "error", message: reason, sessionId: this.sessionId });
        if (usedResume) {
          this.engineSessionId = null;
        }
      }

      // Persist after the turn completes
      this.engineTurnCounts[this.agentId] = this.conversationLog.length;
      persistSession(this.sessionId, this.engineSessionId, this.conversationLog, this.lastPrompt, this.agentId, this.modelId, {
        markEngineCaughtUp: true,
      });

      // Auto-capture to Supabase memories on a turn-count milestone — every 5
      // turns we snapshot the conversation tail so a closed tab / crashed
      // bridge / forgotten /evolve cycle can't lose the work. Background
      // promise: never blocks session_end emission.
      this.maybeCaptureMemory("milestone");

      this.send({
        type: "session_end",
        cost: undefined,
        usage: undefined,
        sessionId: this.sessionId,
      });
    });

    proc.on("error", (err) => {
      console.error(`[session:${this.sessionId}] spawn error:`, err.message);
      this.clearTimeout();
      this.send({ type: "error", message: err.message, sessionId: this.sessionId });
      this.errorSentThisTurn = true;
      // Flush whatever conversation we have so the crash doesn't strand it.
      this.maybeCaptureMemory("exit");
      this.send({ type: "session_end", cost: undefined, usage: undefined, sessionId: this.sessionId });
      this.process = null;
    });
  }

  private resetTimeout(proc: ChildProcess) {
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      console.warn(`[session:${this.sessionId}] timeout — no output for 120s, killing process`);
      proc.kill("SIGTERM");
      this.send({ type: "error", message: "Session timed out (no output for 120s)", sessionId: this.sessionId });
    }, 120_000);
  }

  /** Snapshot the recent conversation tail to Supabase memories. Called
   *  every CAPTURE_TURN_INTERVAL turns and on hard exits — fire-and-forget,
   *  never blocks the session lifecycle. Reason is just for logging. */
  private maybeCaptureMemory(reason: "milestone" | "exit"): void {
    const CAPTURE_TURN_INTERVAL = 5;
    const turns = this.conversationLog.length;
    const delta = turns - this.lastCapturedTurnCount;
    if (reason === "milestone" && delta < CAPTURE_TURN_INTERVAL) return;
    if (turns === 0) return;
    this.lastCapturedTurnCount = turns;
    const workspace = path.basename(process.env.WORKSPACE_ROOT || WORKSPACE_ROOT);
    captureSessionSummary({
      workspace,
      sessionId: this.sessionId,
      conversationLog: this.conversationLog,
      toolsUsed: [this.agentId],
    }).then((r) => {
      if (!r.ok) console.error(`[session:${this.sessionId}] memory capture (${reason}) failed:`, r.error);
    }).catch((err) => {
      console.error(`[session:${this.sessionId}] memory capture (${reason}) threw:`, err?.message ?? err);
    });
  }

  private clearTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private handleStreamEvent(event: any): string | null {
    switch (event.type) {
      case "system": {
        // Only `init` carries the real conversation session_id. Hook events
        // (`hook_started` / `hook_progress` / `hook_response`) carry their own
        // hook UUID, which would corrupt --resume on the next turn.
        if (event.subtype === "init" && event.session_id) {
          this.engineSessionId = event.session_id;
          console.log(`[session:${this.sessionId}/${this.agentId}] engine id:`, this.engineSessionId);
          persistSession(this.sessionId, this.engineSessionId, this.conversationLog, this.lastPrompt, this.agentId, this.modelId);
        }
        return null;
      }

      case "assistant": {
        const content = event.message?.content;
        let text = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              this.send({ type: "claude_message", message: block.text, sessionId: this.sessionId });
              text += block.text;
            } else if (block.type === "tool_use") {
              this.send({
                type: "tool_event",
                toolName: block.name || "unknown",
                input: block.input || {},
                sessionId: this.sessionId,
                timestamp: Date.now(),
              });
            }
          }
        } else if (typeof content === "string") {
          this.send({ type: "claude_message", message: content, sessionId: this.sessionId });
          text = content;
        }
        return text || null;
      }

      case "content_block_delta": {
        const text = event.delta?.type === "text_delta" && typeof event.delta.text === "string"
          ? event.delta.text
          : null;
        if (text) this.send({ type: "claude_message", message: text, sessionId: this.sessionId });
        return text;
      }

      case "result": {
        if (event.session_id) {
          this.engineSessionId = event.session_id;
        }
        if (event.is_error && (
          event.api_error_status === 401 ||
          event.error === "authentication_failed" ||
          /authentication/i.test(String(event.result || ""))
        )) {
          const reason = `${getAgent(this.agentId).label} authentication failed. Reconnect this engine in the CLI or use another available engine.`;
          markAgentAuthFailure(this.agentId, reason);
          this.send({ type: "error", message: reason, sessionId: this.sessionId });
          this.errorSentThisTurn = true;
        }
        return null;
      }

      default: {
        if (event.type === "tool_use" || event.tool_name) {
          this.send({
            type: "tool_event",
            toolName: event.tool_name || event.name || "unknown",
            input: event.input || {},
            sessionId: this.sessionId,
            timestamp: Date.now(),
          });
        }
        return null;
      }
    }
  }

  // Codex `exec --json` event shape:
  //   { type: "thread.started", thread_id: "..." }
  //   { type: "turn.started" }
  //   { type: "item.started", item: { id, type: "agent_message" | "command_execution" | ..., text?, command? } }
  //   { type: "item.completed", item: { ... , text? } }
  //   { type: "turn.completed", usage: { input_tokens, output_tokens, ... } }
  private handleCodexEvent(event: any): string | null {
    switch (event.type) {
      case "thread.started": {
        if (event.thread_id) {
          this.engineSessionId = event.thread_id;
          console.log(`[session:${this.sessionId}/${this.agentId}] codex thread:`, this.engineSessionId);
          persistSession(this.sessionId, this.engineSessionId, this.conversationLog, this.lastPrompt, this.agentId, this.modelId);
        }
        return null;
      }
      case "item.completed":
      case "item.started": {
        const item = event.item || {};
        // The assistant's final message
        if (item.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
          // Only emit on completion to avoid duplicating streamed chunks
          if (event.type === "item.completed") {
            this.send({ type: "claude_message", message: item.text, sessionId: this.sessionId });
            return item.text;
          }
          return null;
        }
        // Tool-like items Codex runs (command execution, reads, etc.)
        if (item.type === "command_execution" && item.command) {
          this.send({
            type: "tool_event",
            toolName: "bash",
            input: { command: item.command },
            sessionId: this.sessionId,
            timestamp: Date.now(),
          });
        }
        if (typeof item.type === "string" && (item.type.includes("mcp") || item.type.includes("tool"))) {
          const server = item.server_name || item.server || item.mcp_server_name;
          const name = item.tool_name || item.name || item.tool || item.type;
          const toolName = server && name ? `mcp__${server}__${name}` : String(name || item.type);
          this.send({
            type: "tool_event",
            toolName,
            input: item.arguments || item.args || item.input || item.params || {},
            sessionId: this.sessionId,
            timestamp: Date.now(),
          });
        }
        return null;
      }
      case "turn.failed":
      case "error": {
        const message = event.message || event.error || event.reason || "Codex turn failed";
        this.send({ type: "error", message: typeof message === "string" ? message : JSON.stringify(message), sessionId: this.sessionId });
        this.errorSentThisTurn = true;
        return null;
      }
      case "turn.completed":
      case "turn.started":
      default:
        return null;
    }
  }

  async followUp(prompt: string): Promise<void> {
    await this.start(prompt, WORKSPACE_ROOT);
  }

  async interrupt(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGINT");
    }
  }

  close(): void {
    this.clearTimeout();
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  private send(msg: ServerMessage): void {
    // Prefer the manager — it handles queueing when no client is attached
    // so browser blips mid-turn don't lose output.
    if (this.manager) {
      this.manager.broadcast(msg);
      return;
    }
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
