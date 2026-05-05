// Smoke test: open a WS to the bridge, start a CLAUDE session with a tiny
// prompt, print every server message, exit when session_end lands.
// Run from dashboard/: node scripts/test-claude-chat.mjs

import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3100");
const sessionId = "smoke-claude-" + Date.now();
const TIMEOUT_MS = 90_000;

const deadline = setTimeout(() => {
  console.error("TIMEOUT: no terminal event in", TIMEOUT_MS, "ms");
  process.exit(2);
}, TIMEOUT_MS);

let gotAnyText = false;
let authReported = null;

ws.on("open", () => {
  console.log("ws open, sending start...");
  ws.send(JSON.stringify({
    type: "start",
    sessionId,
    agentId: "claude",
    modelId: "claude-haiku-4-5-20251001",
    prompt: "Reply with exactly the word OK and nothing else.",
    cwd: process.cwd(),
  }));
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  const tag = msg.type || "?";
  // Skip noisy project_update broadcasts
  if (tag === "project_update") return;
  console.log(`[${tag}]`, JSON.stringify(msg).slice(0, 250));

  if (tag === "session_start") {
    authReported = msg.auth;
  }
  if (tag === "claude_message" && typeof msg.message === "string" && msg.message.trim()) {
    gotAnyText = true;
  }
  if (tag === "session_end") {
    clearTimeout(deadline);
    console.log("\n=== SESSION END — auth:", authReported, "— gotAnyText:", gotAnyText, "===");
    ws.close();
    setTimeout(() => process.exit(gotAnyText ? 0 : 3), 200);
  }
  if (tag === "error") {
    clearTimeout(deadline);
    console.error("\n=== ENGINE ERROR ===");
    ws.close();
    setTimeout(() => process.exit(4), 200);
  }
});

ws.on("error", (err) => { console.error("ws error:", err.message); process.exit(5); });
ws.on("close", () => { if (deadline) clearTimeout(deadline); });
