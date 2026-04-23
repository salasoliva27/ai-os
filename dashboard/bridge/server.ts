import express, { type Request, type Response } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import Anthropic from "@anthropic-ai/sdk";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const PORT = Number(process.env.PORT || 3100);
const FRONTEND_DIST = path.join(WORKSPACE_ROOT, "dashboard", "frontend", "dist");
const REPO_ENV = path.join(WORKSPACE_ROOT, ".env");
const REPO_GITIGNORE = path.join(WORKSPACE_ROOT, ".gitignore");
const PROFILE_PATH = path.join(WORKSPACE_ROOT, ".dashboard", "profile.json");

type Profile = {
  firstBoot: boolean;
  aiKind: string | null;
  enabledTools: string[];
  systemPromptAdditions: string;
  updatedAt: number;
};

const DEFAULT_PROFILE: Profile = {
  firstBoot: true,
  aiKind: null,
  enabledTools: ["credentials"],
  systemPromptAdditions: "",
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

function loadEnvFile(): Record<string, string> {
  if (!fs.existsSync(REPO_ENV)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(REPO_ENV, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

function writeEnvFile(env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(REPO_ENV, lines.join("\n") + "\n");
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.get("/api/profile", (_req, res) => {
  res.json(loadProfile());
});

app.post("/api/profile", (req: Request, res: Response) => {
  const current = loadProfile();
  const next: Profile = {
    ...current,
    ...req.body,
    enabledTools: Array.isArray(req.body?.enabledTools)
      ? Array.from(new Set([...current.enabledTools, ...req.body.enabledTools]))
      : current.enabledTools,
  };
  saveProfile(next);
  res.json(next);
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
const wss = new WebSocketServer({ server, path: "/ws" });

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
  const base = `You are the AI brain of an ai-os workspace — a blank-slate Claude Code template the user just cloned. Be concise. Speak in the user's language.`;
  const onboarding = profile.firstBoot
    ? `

THIS IS THE USER'S FIRST CONVERSATION. Run a brief onboarding:
1. Greet them and ask what kind of AI they want this to be (e.g. coding assistant, writing partner, research tool, business operator, something else). Keep it open — one short question.
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

wss.on("connection", (ws) => {
  send(ws, { type: "ready", profile: loadProfile() });

  const history: { role: "user" | "assistant"; content: string }[] = [];

  ws.on("message", async (raw) => {
    let msg: WsIn;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "ping") return;
    if (msg.type !== "prompt") return;

    if (!process.env.ANTHROPIC_API_KEY) {
      send(ws, {
        type: "error",
        message: "ANTHROPIC_API_KEY not set. Open Credentials and add it.",
      });
      send(ws, { type: "done" });
      return;
    }

    const profile = loadProfile();
    history.push({ role: "user", content: msg.text });

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const stream = await client.messages.stream({
        model: process.env.AI_OS_MODEL || "claude-opus-4-7",
        max_tokens: 4096,
        system: buildSystemPrompt(profile),
        messages: history.map((h) => ({ role: h.role, content: h.content })),
      });

      let full = "";
      stream.on("text", (delta) => {
        full += delta;
        send(ws, { type: "chunk", text: delta });
      });

      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      history.push({ role: "assistant", content: text });

      const m = text.match(PROFILE_RE);
      if (m) {
        try {
          const update = JSON.parse(m[1]);
          const merged = loadProfile();
          if (typeof update.aiKind === "string") merged.aiKind = update.aiKind;
          if (Array.isArray(update.enabledTools)) {
            merged.enabledTools = Array.from(
              new Set(["credentials", ...update.enabledTools]),
            );
          }
          if (typeof update.systemPromptAdditions === "string") {
            merged.systemPromptAdditions = update.systemPromptAdditions;
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
  console.log(`[ai-os] anthropic: ${process.env.ANTHROPIC_API_KEY ? "configured" : "MISSING — open Credentials"}`);
});
