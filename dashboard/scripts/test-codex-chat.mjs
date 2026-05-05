// Smoke test: open a WS to the bridge, start a codex session with a tiny prompt,
// print every server message, exit when we get a turn.completed-style signal or a final text.
// Run from dashboard/: node scripts/test-codex-chat.mjs

import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3100");
const sessionId = "smoke-codex-" + Date.now();
const TIMEOUT_MS = 60_000;

const deadline = setTimeout(() => {
  console.error("TIMEOUT: no terminal event in", TIMEOUT_MS, "ms");
  process.exit(2);
}, TIMEOUT_MS);

let gotAnyText = false;

ws.on("open", () => {
  console.log("ws open, sending start...");
  ws.send(JSON.stringify({
    type: "start",
    sessionId,
    agentId: "codex",
    modelId: "gpt-5.5",
    prompt: "Reply with exactly the word OK and nothing else.",
    cwd: process.cwd(),
  }));
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch { console.log("non-json:", String(raw).slice(0, 200)); return; }
  const tag = msg.type || msg.subtype || "?";
  const preview = JSON.stringify(msg).slice(0, 300);
  console.log(`[${tag}]`, preview);

  // Codex emits text via item.completed / agent_message events
  if (msg.type === "text" || msg.type === "assistant" || msg.type === "agent_message" || (msg.text && msg.text.length > 0)) {
    gotAnyText = true;
  }

  // Terminal events from any engine
  if (msg.type === "result" || msg.type === "turn.completed" || msg.type === "session_complete" || msg.type === "done") {
    clearTimeout(deadline);
    console.log("\n=== TURN COMPLETE — gotAnyText:", gotAnyText, "===");
    ws.close();
    setTimeout(() => process.exit(gotAnyText ? 0 : 3), 200);
  }
  if (msg.type === "error") {
    clearTimeout(deadline);
    console.error("\n=== ENGINE ERROR ===");
    ws.close();
    setTimeout(() => process.exit(4), 200);
  }
});

ws.on("error", (err) => {
  console.error("ws error:", err.message);
  process.exit(5);
});

ws.on("close", () => {
  if (deadline) clearTimeout(deadline);
});
