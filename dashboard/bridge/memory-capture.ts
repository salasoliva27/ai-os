// Bridge-side memory capture — writes session summaries + corrections directly
// to Supabase, bypassing the memory MCP. The MCP is great for interactive
// `mcp__memory__remember` calls from chat agents, but it's an extra process
// that can disconnect/crash and writes silently fail. For autonomous captures
// triggered by the bridge itself (session_end, tab close, etc.), we cut out
// the middleman and INSERT straight into Supabase using the schema in
// mcp-servers/memory/setup.sql.
//
// Embedding pipeline mirrors mcp-servers/memory/index.js:
//   - voyage-3-lite, 512 dims
//   - silently fall back to text-search-only when VOYAGE_API_KEY missing/dead
//
// On every successful insert we also append a row to brain_events for audit.

import { readVarFromDotfiles } from "./agent-registry.js";

function envOrDotfile(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  return readVarFromDotfiles(name) ?? "";
}

interface MemoryConfig {
  supabaseUrl: string;
  supabaseKey: string;
  voyageKey: string | null;
}

function loadConfig(): MemoryConfig | null {
  const supabaseUrl = envOrDotfile("SUPABASE_URL").replace(/\/+$/, "");
  const supabaseKey = envOrDotfile("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseKey) return null;
  return {
    supabaseUrl,
    supabaseKey,
    voyageKey: envOrDotfile("VOYAGE_API_KEY") || null,
  };
}

async function generateEmbedding(text: string, voyageKey: string | null): Promise<number[] | null> {
  if (!voyageKey) return null;
  try {
    const r = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${voyageKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: text.slice(0, 8000), model: "voyage-3-lite", output_dimension: 512 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { data?: Array<{ embedding?: number[] }> };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function supabaseInsert(cfg: MemoryConfig, table: string, row: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: cfg.supabaseKey,
        Authorization: `Bearer ${cfg.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, error: `${r.status}: ${txt.slice(0, 300)}` };
    }
    const data = (await r.json()) as Array<{ id?: string }>;
    return { ok: true, id: data[0]?.id };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

async function logBrainEvent(cfg: MemoryConfig, evt: { workspace: string; project: string; tool_name: string; status: string; error_message?: string | null; args?: unknown }): Promise<void> {
  await supabaseInsert(cfg, "brain_events", {
    workspace: evt.workspace,
    project: evt.project,
    tool_name: evt.tool_name,
    session_id: null,
    args: evt.args ?? null,
    status: evt.status,
    error_message: evt.error_message ?? null,
  });
}

export interface SessionSummaryInput {
  workspace: string;
  project?: string;
  conversationLog: string[];           // raw turn log; we'll trim + condense
  toolsUsed?: string[];
  filesChanged?: string[];
  decisions?: string[];
  learnings?: string[];
  nextSteps?: string[];
  sessionId?: string;
}

function condenseConversation(log: string[]): string {
  // Keep the last ~12 turns of meaningful content, capped at 4000 chars per turn
  // so a runaway transcript can't blow up the embedding budget.
  const tail = log.slice(-12).map((t) => t.slice(0, 4000));
  return tail.join("\n---\n").slice(0, 12000);
}

export async function captureSessionSummary(input: SessionSummaryInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" };

  const summary = condenseConversation(input.conversationLog);
  const project = input.project || input.workspace;

  // Build a structured content body so future recalls are easy to scan.
  const sections: string[] = [];
  sections.push(`# Session summary — ${new Date().toISOString().slice(0, 10)}`);
  if (input.sessionId) sections.push(`Session: ${input.sessionId}`);
  if (input.toolsUsed?.length) sections.push(`Tools: ${input.toolsUsed.join(", ")}`);
  if (input.filesChanged?.length) sections.push(`Files changed:\n- ${input.filesChanged.slice(0, 30).join("\n- ")}`);
  if (input.decisions?.length) sections.push(`Decisions:\n- ${input.decisions.join("\n- ")}`);
  if (input.learnings?.length) sections.push(`Learnings:\n- ${input.learnings.join("\n- ")}`);
  if (input.nextSteps?.length) sections.push(`Next steps:\n- ${input.nextSteps.join("\n- ")}`);
  sections.push(`---\nConversation tail:\n${summary}`);
  const content = sections.join("\n\n");

  const embedding = await generateEmbedding(content, cfg.voyageKey);
  const metadata = {
    tags: ["session-summary", "auto-capture", "bridge"],
    sessionId: input.sessionId ?? null,
    toolsUsed: input.toolsUsed ?? [],
    filesChanged: input.filesChanged ?? [],
  };

  const result = await supabaseInsert(cfg, "memories", {
    workspace: input.workspace,
    project,
    type: "session",
    content,
    metadata,
    embedding,
  });

  // Audit row regardless of insert outcome.
  await logBrainEvent(cfg, {
    workspace: input.workspace,
    project,
    tool_name: "bridge.captureSessionSummary",
    status: result.ok ? "success" : "error",
    error_message: result.error,
    args: { sessionId: input.sessionId, conversationTurns: input.conversationLog.length },
  }).catch(() => {});

  if (result.ok) {
    console.log(`[memory-capture] session summary written → ${result.id} (workspace=${input.workspace}, embedding=${embedding ? "voyage" : "text-only"})`);
  } else {
    console.error(`[memory-capture] session summary failed: ${result.error}`);
  }
  return result;
}

export interface CorrectionInput {
  workspace: string;
  project?: string;
  context: string;            // what the agent did
  rule: string;               // what it should do instead
  sessionId?: string;
}

export async function captureCorrection(input: CorrectionInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" };

  const content = `# Correction\n\n## Context\n${input.context}\n\n## Rule\n${input.rule}`;
  const embedding = await generateEmbedding(content, cfg.voyageKey);
  const project = input.project || input.workspace;

  const result = await supabaseInsert(cfg, "memories", {
    workspace: input.workspace,
    project,
    type: "correction",
    content,
    metadata: { tags: ["correction", "auto-capture", "bridge"], sessionId: input.sessionId ?? null },
    embedding,
  });
  await logBrainEvent(cfg, {
    workspace: input.workspace,
    project,
    tool_name: "bridge.captureCorrection",
    status: result.ok ? "success" : "error",
    error_message: result.error,
  }).catch(() => {});
  return result;
}

/** Cheap health probe — counts memories + max(created_at) for the workspace. */
export async function memoryHealthSnapshot(workspace: string): Promise<{
  configured: boolean;
  reachable: boolean;
  totalMemories: number | null;
  lastWriteAt: string | null;
  daysSinceLastWrite: number | null;
  voyageConfigured: boolean;
  error: string | null;
}> {
  const cfg = loadConfig();
  if (!cfg) {
    return { configured: false, reachable: false, totalMemories: null, lastWriteAt: null, daysSinceLastWrite: null, voyageConfigured: false, error: "Supabase env vars missing" };
  }
  try {
    // Two separate calls: count via HEAD with Prefer: count=exact, and last_ts via single-row select.
    const head = await fetch(`${cfg.supabaseUrl}/rest/v1/memories?select=id&workspace=eq.${encodeURIComponent(workspace)}`, {
      method: "HEAD",
      headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}`, Prefer: "count=exact" },
      signal: AbortSignal.timeout(8_000),
    });
    const range = head.headers.get("content-range") ?? "";
    const total = parseInt(range.split("/").pop() ?? "0", 10);

    const lastResp = await fetch(`${cfg.supabaseUrl}/rest/v1/memories?select=created_at&workspace=eq.${encodeURIComponent(workspace)}&order=created_at.desc&limit=1`, {
      headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    let lastAt: string | null = null;
    if (lastResp.ok) {
      const arr = (await lastResp.json()) as Array<{ created_at?: string }>;
      lastAt = arr[0]?.created_at ?? null;
    }
    const daysSince = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000)) : null;
    return {
      configured: true,
      reachable: head.ok,
      totalMemories: Number.isFinite(total) ? total : null,
      lastWriteAt: lastAt,
      daysSinceLastWrite: daysSince,
      voyageConfigured: !!cfg.voyageKey,
      error: head.ok ? null : `HTTP ${head.status}`,
    };
  } catch (err) {
    return { configured: true, reachable: false, totalMemories: null, lastWriteAt: null, daysSinceLastWrite: null, voyageConfigured: !!cfg.voyageKey, error: String(err instanceof Error ? err.message : err) };
  }
}
