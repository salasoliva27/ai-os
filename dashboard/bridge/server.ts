import express, { type Request, type Response } from "express";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import Anthropic from "@anthropic-ai/sdk";
import { mountAuth } from "./auth.js";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const PORT = Number(process.env.PORT || 3100);
const FRONTEND_DIST = path.join(WORKSPACE_ROOT, "dashboard", "frontend", "dist");
const REPO_ENV = path.join(WORKSPACE_ROOT, ".env");
const REPO_GITIGNORE = path.join(WORKSPACE_ROOT, ".gitignore");
const PROFILE_PATH = path.join(WORKSPACE_ROOT, ".dashboard", "profile.json");
const CLAUDE_OAUTH_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

type Profile = {
  firstBoot: boolean;
  aiName: string | null;
  aiKind: string | null;
  enabledTools: string[];
  systemPromptAdditions: string;
  defaultEngine: EngineId | null;
  updatedAt: number;
};

type EngineId = "anthropic" | "openai";
type EngineMode = "anthropic-api-key" | "anthropic-oauth" | "openai-api-key" | "none";

const DEFAULT_PROFILE: Profile = {
  firstBoot: true,
  aiName: null,
  aiKind: null,
  enabledTools: ["credentials"],
  systemPromptAdditions: "",
  defaultEngine: null,
  updatedAt: Date.now(),
};

function loadProfile(): Profile {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(p: Profile): void {
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify({ ...p, updatedAt: Date.now() }, null, 2));
}

function cleanAiName(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 48) : fallback;
}

function loadEnvFile(): Record<string, string> {
  if (!fs.existsSync(REPO_ENV)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(REPO_ENV, "utf-8").split("\n")) {
    const m = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value
      .replace(/\\"/g, '"')
      .replace(/\\\$/g, "$")
      .replace(/\\\\/g, "\\");
  }
  return out;
}

function writeEnvFile(env: Record<string, string>): void {
  const quote = (v: string) =>
    `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
  const lines = Object.entries(env).map(([k, v]) => `export ${k}=${quote(v)}`);
  fs.writeFileSync(REPO_ENV, lines.join("\n") + "\n");
}

function loadOAuthToken(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(CLAUDE_OAUTH_PATH, "utf-8"));
    const token = data?.claudeAiOauth?.accessToken;
    const expiresAt = data?.claudeAiOauth?.expiresAt;
    if (typeof token !== "string" || !token) return null;
    if (typeof expiresAt === "number" && expiresAt < Date.now()) return null;
    return token;
  } catch {
    return null;
  }
}

type AuthMode = "env-file" | "oauth" | "shell-env" | "none";

function buildAnthropicClient(): { client: Anthropic; mode: AuthMode } | { client: null; mode: "none" } {
  const envFileKey = loadEnvFile().ANTHROPIC_API_KEY;
  if (envFileKey) return { client: new Anthropic({ apiKey: envFileKey }), mode: "env-file" };

  const oauth = loadOAuthToken();
  if (oauth) {
    return {
      client: new Anthropic({
        authToken: oauth,
        apiKey: null,
        defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER },
      }),
      mode: "oauth",
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return { client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), mode: "shell-env" };
  }
  return { client: null, mode: "none" };
}

function openAiKey(): string | null {
  return loadEnvFile().OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
}

function availableEngines(): EngineId[] {
  const out: EngineId[] = [];
  if (buildAnthropicClient().mode !== "none") out.push("anthropic");
  if (openAiKey()) out.push("openai");
  return out;
}

function activeEngine(profile: Profile): { engine: EngineId | null; mode: EngineMode } {
  const available = availableEngines();
  if (profile.defaultEngine && available.includes(profile.defaultEngine)) {
    return {
      engine: profile.defaultEngine,
      mode: profile.defaultEngine === "openai"
        ? "openai-api-key"
        : buildAnthropicClient().mode === "oauth"
          ? "anthropic-oauth"
          : "anthropic-api-key",
    };
  }
  const engine = available[0] ?? null;
  if (!engine) return { engine: null, mode: "none" };
  return {
    engine,
    mode: engine === "openai"
      ? "openai-api-key"
      : buildAnthropicClient().mode === "oauth"
        ? "anthropic-oauth"
        : "anthropic-api-key",
  };
}

function ensureGitignored(): void {
  let gi = fs.existsSync(REPO_GITIGNORE) ? fs.readFileSync(REPO_GITIGNORE, "utf-8") : "";
  const has = gi.split("\n").some((l) => l.trim() === ".env");
  if (!has) {
    if (gi.length > 0 && !gi.endsWith("\n")) gi += "\n";
    gi += ".env\n";
    fs.writeFileSync(REPO_GITIGNORE, gi);
  }
}

// ── HTTP + WS server ─────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "20mb" }));

// Auth gate (no-op when ENFORCE is false — see auth.ts). Mounted BEFORE any
// routes so cookie-session applies to all of them.
const auth = mountAuth(app);

app.get("/api/health", (_req, res) => {
  const profile = loadProfile();
  const active = activeEngine(profile);
  res.json({
    ok: true,
    profile,
    activeEngine: active.engine,
    engineMode: active.mode,
    availableEngines: availableEngines(),
    engineConfigured: active.engine !== null,
    anthropicConfigured: buildAnthropicClient().mode !== "none",
    openaiConfigured: Boolean(openAiKey()),
  });
});

app.get("/health", (_req, res) => {
  const active = activeEngine(loadProfile());
  res.json({ ok: true, engineConfigured: active.engine !== null });
});

app.get("/api/profile", (_req, res) => {
  res.json(loadProfile());
});

app.post("/api/profile", (req: Request, res: Response) => {
  const current = loadProfile();
  const next: Profile = {
    ...current,
    ...req.body,
    aiName: cleanAiName(req.body?.aiName, current.aiName || "") || current.aiName,
    defaultEngine:
      req.body?.defaultEngine === "anthropic" || req.body?.defaultEngine === "openai"
        ? req.body.defaultEngine
        : current.defaultEngine,
    enabledTools: Array.isArray(req.body?.enabledTools)
      ? Array.from(new Set([...current.enabledTools, ...req.body.enabledTools]))
      : current.enabledTools,
  };
  saveProfile(next);
  res.json(next);
});

app.post("/api/engine/setup", (req: Request, res: Response) => {
  const body = (req.body || {}) as { aiName?: unknown; engine?: unknown; apiKey?: unknown };
  const aiName = cleanAiName(body.aiName);
  const engine = body.engine === "openai" ? "openai" : body.engine === "anthropic" ? "anthropic" : null;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!aiName) {
    res.status(400).json({ error: "Name your AI first." });
    return;
  }
  if (!engine) {
    res.status(400).json({ error: "Choose an engine." });
    return;
  }
  if (!apiKey && !availableEngines().includes(engine)) {
    res.status(400).json({ error: "Paste an API key for the selected engine." });
    return;
  }

  if (apiKey) {
    ensureGitignored();
    const env = loadEnvFile();
    env[engine === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] = apiKey;
    writeEnvFile(env);
    process.env[engine === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] = apiKey;
  }

  const profile = loadProfile();
  profile.aiName = aiName;
  profile.defaultEngine = engine;
  saveProfile(profile);
  res.json({ ok: true, profile, activeEngine: engine });
});

app.post("/api/credentials/save", (req: Request, res: Response) => {
  const { key, value } = req.body || {};
  if (typeof key !== "string" || !/^[A-Z0-9_]+$/.test(key)) {
    res.status(400).json({ error: "invalid key" });
    return;
  }
  if (typeof value !== "string") {
    res.status(400).json({ error: "value must be a string" });
    return;
  }
  ensureGitignored();
  const env = loadEnvFile();
  env[key] = value;
  writeEnvFile(env);
  process.env[key] = value;
  res.json({ ok: true, mode: "repo-local", key });
});

app.use(express.static(FRONTEND_DIST));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

const server = http.createServer(app);
// noServer:true so auth.bindWs handles the upgrade event (validates session
// cookie before letting the WS through, AND filters to /ws path).
const wss = new WebSocketServer({ noServer: true });
auth.bindWs(server, wss, "/ws");

type WsIn =
  | { type: "prompt"; text: string }
  | { type: "ping" };

type WsOut =
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "ready"; profile: Profile };

function send(ws: WebSocket, msg: WsOut) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function buildSystemPrompt(profile: Profile): string {
  const name = profile.aiName || "this AI";
  const base = `You are ${name}, the AI brain of this workspace. It began as the generic ai-os template, but this clone now belongs to the user. Be concise. Speak in the user's language.`;
  const onboarding = profile.firstBoot
    ? `

THIS IS THE USER'S FIRST CONVERSATION. Run a brief onboarding:
1. Greet them using the name "${name}" and ask what kind of AI they want this to be (e.g. coding assistant, writing partner, research tool, business operator, something else). Keep it open — one short question.
2. Based on their answer, recommend which UI panels to enable. The available panels are:
   - "credentials" (always on — manage API keys)
   - "files" (read/write files in the repo)
   - "tasks" (todo + project tracker)
   - "memory" (persistent memory across sessions)
   - "calendar" (Google Calendar integration)
   - "research" (web search panel)
3. When the user agrees, finalize by emitting EXACTLY this line on its own (the dashboard parses it):
   <<PROFILE: {"aiKind":"<short-label>","enabledTools":["credentials","files",...],"systemPromptAdditions":"<one-line tailored instruction for future sessions>","firstBoot":false}>>
4. Then a one-line summary of what's now enabled.

Do not emit the PROFILE line until the user confirms. Do not invent panels not in the list above.`
    : "";
  const tail = profile.systemPromptAdditions
    ? `\n\nUser's tailored profile: ${profile.systemPromptAdditions}`
    : "";
  return base + onboarding + tail;
}

const PROFILE_RE = /<<PROFILE:\s*(\{[^}]*\})\s*>>/;

type ChatHistory = { role: "user" | "assistant"; content: string }[];

async function completeWithOpenAi(system: string, history: ChatHistory): Promise<string> {
  const key = openAiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.AI_OS_OPENAI_MODEL || "gpt-5",
      instructions: system,
      input: history.map((h) => ({ role: h.role, content: h.content })),
      max_output_tokens: 4096,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error?.message === "string"
      ? body.error.message
      : `OpenAI returned HTTP ${response.status}`;
    throw new Error(message);
  }
  if (typeof body.output_text === "string") return body.output_text;
  const chunks: string[] = [];
  for (const item of Array.isArray(body.output) ? body.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

wss.on("connection", (ws) => {
  send(ws, { type: "ready", profile: loadProfile() });

  const history: ChatHistory = [];

  ws.on("message", async (raw) => {
    let msg: WsIn;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "ping") return;
    if (msg.type !== "prompt") return;

    const profile = loadProfile();
    const chosen = activeEngine(profile);
    if (!chosen.engine) {
      send(ws, {
        type: "error",
        message:
          "No engine credentials are configured. Paste an Anthropic or OpenAI API key on the setup screen.",
      });
      send(ws, { type: "done" });
      return;
    }

    history.push({ role: "user", content: msg.text });

    try {
      let full = "";
      if (chosen.engine === "openai") {
        full = await completeWithOpenAi(buildSystemPrompt(profile), history);
        send(ws, { type: "chunk", text: full });
      } else {
        const { client } = buildAnthropicClient();
        if (!client) throw new Error("ANTHROPIC_API_KEY or Claude OAuth is not configured.");
        const stream = await client.messages.stream({
          model: process.env.AI_OS_ANTHROPIC_MODEL || process.env.AI_OS_MODEL || "claude-opus-4-7",
          max_tokens: 4096,
          system: buildSystemPrompt(profile),
          messages: history.map((h) => ({ role: h.role, content: h.content })),
        });

        stream.on("text", (delta) => {
          full += delta;
          send(ws, { type: "chunk", text: delta });
        });

        const final = await stream.finalMessage();
        full = final.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
      }
      history.push({ role: "assistant", content: full });

      const m = full.match(PROFILE_RE);
      if (m) {
        try {
          const update = JSON.parse(m[1]);
          const merged = loadProfile();
          if (typeof update.aiName === "string") merged.aiName = cleanAiName(update.aiName, merged.aiName || "") || merged.aiName;
          if (typeof update.aiKind === "string") merged.aiKind = update.aiKind;
          if (Array.isArray(update.enabledTools)) {
            merged.enabledTools = Array.from(
              new Set(["credentials", ...update.enabledTools]),
            );
          }
          if (typeof update.systemPromptAdditions === "string") {
            merged.systemPromptAdditions = update.systemPromptAdditions;
          }
          if (update.defaultEngine === "anthropic" || update.defaultEngine === "openai") {
            merged.defaultEngine = update.defaultEngine;
          }
          if (update.firstBoot === false) merged.firstBoot = false;
          saveProfile(merged);
        } catch (e) {
          console.warn("[profile] failed to parse PROFILE block:", e);
        }
      }

      send(ws, { type: "done" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      send(ws, { type: "error", message });
      send(ws, { type: "done" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[ai-os] http+ws on http://localhost:${PORT}`);
  console.log(`[ai-os] workspace: ${WORKSPACE_ROOT}`);
  const active = activeEngine(loadProfile());
  const human: Record<EngineMode, string> = {
    "anthropic-api-key": "Anthropic API key",
    "anthropic-oauth": "Claude subscription (OAuth from ~/.claude/.credentials.json)",
    "openai-api-key": "OpenAI API key",
    "none": "MISSING — complete first-run engine setup",
  };
  console.log(`[ai-os] engine: ${active.engine || "none"} (${human[active.mode]})`);
});
