// Jira bridge module — pulls REECE tickets from Atlassian Cloud REST v3.
//
// Reads JIRA_API_KEY, JIRA_EMAIL, JIRA_BASE_URL from process.env or dotfiles.
// Atlassian uses Basic Auth: base64(email:token). Polls every POLL_MS, caches
// the latest fetch, and broadcasts `tickets_set` so newly-connected clients
// see the list immediately and existing tabs get incremental updates.

import { readVarFromDotfiles } from "./agent-registry.js";
import type { ServerMessage } from "./types.js";

const POLL_MS = 2 * 60 * 1000; // 2 min

function envOrDotfile(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  return readVarFromDotfiles(name) ?? "";
}

interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
}

function loadConfig(): JiraConfig | null {
  const baseUrl = envOrDotfile("JIRA_BASE_URL").replace(/\/+$/, "");
  const email = envOrDotfile("JIRA_EMAIL");
  const token = envOrDotfile("JIRA_API_KEY") || envOrDotfile("JIRA_API_TOKEN");
  if (!baseUrl || !email || !token) return null;
  return { baseUrl, email, token };
}

function authHeader(cfg: JiraConfig): string {
  const b64 = Buffer.from(`${cfg.email}:${cfg.token}`, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

function jiraHeaders(cfg: JiraConfig): HeadersInit {
  return {
    Authorization: authHeader(cfg),
    Accept: "application/json",
    "User-Agent": "janus-jira-panel",
  };
}

export interface JiraTicket {
  key: string;                  // e.g. "SCM-1234"
  summary: string;
  status: string;               // e.g. "In Progress"
  statusCategory: string;       // "new" | "indeterminate" | "done"
  priority: string | null;      // "Highest" / "High" / etc.
  assigneeName: string | null;
  reporterName: string | null;
  projectKey: string;
  projectName: string;
  issueType: string;
  updated: string;              // ISO
  created: string;              // ISO
  duedate: string | null;       // ISO date
  url: string;                  // browser link
  labels: string[];
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Flatten Atlassian Document Format → plain text. Detail view only — the
 *  list endpoint doesn't carry the body to keep payloads small. */
function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as AdfNode;
  let out = "";
  if (typeof n.text === "string") out += n.text;
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      out += adfToText(child);
      if (n.type === "paragraph" || n.type === "heading") out += "\n";
    }
  }
  return out;
}

interface RawIssueFields {
  summary?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  priority?: { name?: string } | null;
  assignee?: { displayName?: string } | null;
  reporter?: { displayName?: string } | null;
  project?: { key?: string; name?: string };
  issuetype?: { name?: string };
  updated?: string;
  created?: string;
  duedate?: string | null;
  labels?: string[];
  description?: unknown;
  comment?: { comments?: Array<{ author?: { displayName?: string }; created?: string; body?: unknown }> };
}

interface RawIssue {
  key: string;
  fields: RawIssueFields;
}

function shapeTicket(raw: RawIssue, baseUrl: string): JiraTicket {
  const f = raw.fields;
  return {
    key: raw.key,
    summary: f.summary ?? "",
    status: f.status?.name ?? "",
    statusCategory: f.status?.statusCategory?.key ?? "",
    priority: f.priority?.name ?? null,
    assigneeName: f.assignee?.displayName ?? null,
    reporterName: f.reporter?.displayName ?? null,
    projectKey: f.project?.key ?? "",
    projectName: f.project?.name ?? "",
    issueType: f.issuetype?.name ?? "",
    updated: f.updated ?? "",
    created: f.created ?? "",
    duedate: f.duedate ?? null,
    url: `${baseUrl}/browse/${raw.key}`,
    labels: f.labels ?? [],
  };
}

export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC";

let lastTickets: JiraTicket[] = [];
let lastError: string | null = null;
let lastFetchedAt: string | null = null;

async function fetchTicketsRaw(cfg: JiraConfig, jql: string, maxResults = 100): Promise<JiraTicket[]> {
  // Atlassian deprecated /rest/api/3/search in favor of /rest/api/3/search/jql
  // for Cloud during 2025; use the new endpoint and fall back if 410/404.
  const fields = "summary,status,priority,assignee,reporter,project,issuetype,updated,created,duedate,labels";
  const body = JSON.stringify({ jql, maxResults, fields: fields.split(",") });
  const tryEndpoints = [
    `${cfg.baseUrl}/rest/api/3/search/jql`,
    `${cfg.baseUrl}/rest/api/3/search`,
  ];
  for (const url of tryEndpoints) {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...jiraHeaders(cfg), "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 404 || r.status === 410) continue;
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Jira search returned ${r.status}: ${txt.slice(0, 300)}`);
    }
    const data = (await r.json()) as { issues?: RawIssue[] };
    return (data.issues ?? []).map((i) => shapeTicket(i, cfg.baseUrl));
  }
  throw new Error("No working Jira search endpoint (both /search and /search/jql returned 404/410)");
}

export interface JiraTicketDetail extends JiraTicket {
  description: string;
  comments: Array<{ author: string; createdAt: string; body: string }>;
}

export async function fetchTicketDetail(key: string): Promise<JiraTicketDetail | null> {
  const cfg = loadConfig();
  if (!cfg) return null;
  try {
    const url = `${cfg.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=*all&expand=renderedFields`;
    const r = await fetch(url, { headers: jiraHeaders(cfg), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const raw = (await r.json()) as RawIssue;
    const base = shapeTicket(raw, cfg.baseUrl);
    const description = adfToText(raw.fields.description);
    const comments = (raw.fields.comment?.comments ?? []).map((c) => ({
      author: c.author?.displayName ?? "unknown",
      createdAt: c.created ?? "",
      body: adfToText(c.body),
    }));
    return { ...base, description, comments };
  } catch {
    return null;
  }
}

export async function pollJiraOnce(broadcast: (m: ServerMessage) => void): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    lastError = "JIRA_API_KEY, JIRA_EMAIL, or JIRA_BASE_URL missing — set in dotfiles or workspace .env";
    return;
  }
  try {
    const tickets = await fetchTicketsRaw(cfg, DEFAULT_JQL);
    lastTickets = tickets;
    lastError = null;
    lastFetchedAt = new Date().toISOString();
    broadcast({ type: "tickets_set", tickets } as ServerMessage);
    console.log(`[jira] fetched ${tickets.length} tickets (assigned, not done)`);
  } catch (err) {
    lastError = String(err instanceof Error ? err.message : err);
    console.error("[jira] fetch failed:", lastError);
  }
}

export function startJiraPolling(broadcast: (m: ServerMessage) => void): NodeJS.Timeout {
  // Kick off immediately, then poll on interval.
  pollJiraOnce(broadcast).catch(() => {});
  return setInterval(() => {
    pollJiraOnce(broadcast).catch(() => {});
  }, POLL_MS);
}

/** Sends the cached ticket list to a single client. Used on WS connect so a
 *  fresh tab populates instantly without waiting for the next poll. */
export function sendTicketsSnapshot(send: (m: ServerMessage) => void): void {
  send({ type: "tickets_set", tickets: lastTickets } as ServerMessage);
}

export function jiraSnapshot(): {
  configured: boolean;
  baseUrl: string | null;
  email: string | null;
  ticketsCount: number;
  lastFetchedAt: string | null;
  lastError: string | null;
  byStatus: Record<string, number>;
  byProject: Record<string, number>;
} {
  const cfg = loadConfig();
  const byStatus: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  for (const t of lastTickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byProject[t.projectKey] = (byProject[t.projectKey] ?? 0) + 1;
  }
  return {
    configured: !!cfg,
    baseUrl: cfg?.baseUrl ?? null,
    email: cfg?.email ?? null,
    ticketsCount: lastTickets.length,
    lastFetchedAt,
    lastError,
    byStatus,
    byProject,
  };
}

export function getCachedTickets(): JiraTicket[] {
  return lastTickets;
}

// ── Write operations ─────────────────────────────────────────────────────

export interface Transition {
  id: string;
  name: string;       // "In Progress", "Done", etc.
  toStatus: string;   // status name the transition leads to
}

export async function listTransitions(key: string): Promise<Transition[]> {
  const cfg = loadConfig();
  if (!cfg) return [];
  try {
    const url = `${cfg.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`;
    const r = await fetch(url, { headers: jiraHeaders(cfg), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const data = (await r.json()) as { transitions?: Array<{ id: string; name: string; to?: { name?: string } }> };
    return (data.transitions ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to?.name ?? t.name,
    }));
  } catch {
    return [];
  }
}

export async function applyTransition(key: string, transitionId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "Jira not configured" };
  try {
    const url = `${cfg.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`;
    const r = await fetch(url, {
      method: "POST",
      headers: { ...jiraHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ transition: { id: transitionId } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 204) return { ok: true };
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${txt.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Adf comment shape — Atlassian REST v3 requires Atlassian Document Format
 *  for the body. Wrap a plain string in a minimal valid document. */
function plainTextToAdf(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text
      .split("\n\n")
      .filter((p) => p.trim().length > 0)
      .map((para) => ({
        type: "paragraph",
        content: [{ type: "text", text: para }],
      })),
  };
}

export async function addComment(key: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "Jira not configured" };
  try {
    const url = `${cfg.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/comment`;
    const r = await fetch(url, {
      method: "POST",
      headers: { ...jiraHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ body: plainTextToAdf(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return { ok: true };
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${txt.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}
