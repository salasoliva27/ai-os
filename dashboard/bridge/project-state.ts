// Project-state broadcaster.
//
// Projects are discovered live from the user's GitHub accounts (no hardcoded
// list). The bridge reads a configurable set of GitHub tokens (one per
// account, e.g. personal + work) and merges all visible repos into a single
// project list. On startup we emit a `projects_set` message that fully
// replaces the frontend's array; per-repo enrichment (last commit, memory
// count, optional wiki) follows as `project_update` messages.
//
// Refresh loop runs every REFRESH_MS so new/deleted GitHub repos appear or
// disappear without restarting the bridge. Each repo is tagged with the token
// that discovered it so private-org repos are enriched with the correct token.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ServerMessage } from "./types.js";
import { readVarFromDotfiles } from "./agent-registry.js";
import { parseStatusMd, type ParsedStatus, type NextStep, type Milestone } from "./status-parser.js";
import { scheduleProjects, type ScheduledEvent, type SchedulableProject } from "./scheduler.js";
import { ensureStatusFileForRepo, syncStatusFileMetadataForRepo } from "./bootstrap-status.js";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/workspaces/janus-ia";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const GITHUB_USER_ENV = process.env.GITHUB_USER ?? "";

const REFRESH_MS = parseInt(process.env.JANUS_PROJECT_REFRESH_MS || "60000", 10);
const AUTO_STATUS_BOOTSTRAP = process.env.JANUS_AUTO_STATUS_BOOTSTRAP !== "0";
const AUTO_STATUS_SYNC = process.env.JANUS_AUTO_STATUS_SYNC !== "0";

// Each entry maps an env-var to a human label for the account it represents.
// Add another entry here to surface a third GitHub identity.
const GITHUB_TOKEN_SOURCES: Array<{ envVar: string; label: string }> = [
  { envVar: "GITHUB_TOKEN", label: "personal" },
  { envVar: "GITHUB_TOKEN_REECE", label: "reece" },
];

function envOrDotfile(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  return readVarFromDotfiles(name) ?? "";
}

interface TokenAccount {
  envVar: string;
  label: string;
  token: string;
  login: string | null;
}

async function loadTokenAccounts(): Promise<TokenAccount[]> {
  const out: TokenAccount[] = [];
  for (const src of GITHUB_TOKEN_SOURCES) {
    const tok = envOrDotfile(src.envVar);
    if (!tok) continue;
    out.push({ envVar: src.envVar, label: src.label, token: tok, login: null });
  }
  // Resolve login per account so logs and dedupe work cleanly.
  await Promise.all(
    out.map(async (a) => {
      try {
        const r = await fetch("https://api.github.com/user", {
          headers: ghHeadersFor(a.token),
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = (await r.json()) as { login?: string };
          a.login = data?.login ?? null;
        }
      } catch { /* leave login null */ }
    }),
  );
  return out;
}

type Stage = "idea" | "dev" | "uat" | "prod";
type Health = "green" | "amber" | "red";

interface CommitInfo {
  hash: string;
  message: string;
  age: string;
}

interface DiscoveredProject {
  id: string;
  name: string;
  displayName: string;
  stage: Stage;
  stack: string[];
  health: Health;
  currentPhase: string;
  phaseProgress: number;
  lastCommit: CommitInfo;
  description: string;
  legalFlags: string[];
  nextActions: string[];
  color: string;
  repo: string;
  // Discovery identity — sent to the frontend so cards style per account.
  account: string;     // short label, e.g. 'personal' | 'reece'
  owner: string;       // GitHub login (the part before the slash in `repo`)
  // Local-only (not sent in projects_set):
  defaultBranch: string;
  tokenEnvVar: string;
  wikiSlug?: string;
  memoryProject?: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  language: string | null;
  topics?: string[];
  default_branch: string;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
}

let discovered: DiscoveredProject[] = [];
let lastRepoSignature = "";

function relativeAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function ghHeadersFor(token: string | null): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function listReposForToken(token: string): Promise<GitHubRepo[]> {
  // `affiliation=owner` keeps the list to repos owned by *this token's user* —
  // org repos (where the user is just a member) are excluded. That's what we
  // want: each account contributes only its personal profile, not the whole
  // org's monorepo sprawl.
  const out: GitHubRepo[] = [];
  const perPage = 100;
  let next: string | null = `https://api.github.com/user/repos?per_page=${perPage}&affiliation=owner&sort=pushed`;
  while (next && out.length < 500) {
    try {
      const r: Response = await fetch(next, { headers: ghHeadersFor(token), signal: AbortSignal.timeout(10000) });
      if (!r.ok) break;
      const page = (await r.json()) as GitHubRepo[];
      out.push(...page);
      const link: string = r.headers.get("link") || "";
      const m: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      next = m ? m[1] : null;
    } catch {
      break;
    }
  }
  return out;
}

async function listPublicReposForUser(login: string): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = [];
  const perPage = 100;
  let next: string | null = `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=${perPage}&sort=pushed`;
  while (next && out.length < 500) {
    try {
      const r: Response = await fetch(next, { headers: ghHeadersFor(null), signal: AbortSignal.timeout(10000) });
      if (!r.ok) break;
      const page = (await r.json()) as GitHubRepo[];
      out.push(...page);
      const link: string = r.headers.get("link") || "";
      const m: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
      next = m ? m[1] : null;
    } catch {
      break;
    }
  }
  return out;
}

async function fetchStatusFile(token: string, repo: string): Promise<string | null> {
  if (!token) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/.janus/status.md`, {
      headers: ghHeadersFor(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    if (data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return data.content;
  } catch {
    return null;
  }
}

async function fetchLastCommit(token: string, repo: string, defaultBranch: string): Promise<CommitInfo | null> {
  if (!token) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=10&sha=${encodeURIComponent(defaultBranch)}`, {
      headers: ghHeadersFor(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as Array<{ sha: string; commit: { message: string; author: { date: string } } }>;
    if (!data?.length) return null;
    const c = data.find((x) => {
      const msg = x.commit.message;
      return !msg.startsWith("chore(janus): bootstrap .janus/status.md")
        && !msg.startsWith("chore(janus): sync status metadata");
    }) ?? data[0];
    return {
      hash: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0].slice(0, 80),
      age: relativeAge(c.commit.author.date),
    };
  } catch {
    return null;
  }
}

async function fetchMemoryCount(memoryProject: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/memories?select=id&project=eq.${encodeURIComponent(memoryProject)}`,
      {
        method: "HEAD",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    const range = r.headers.get("content-range");
    if (!range) return 0;
    const total = parseInt(range.split("/").pop() ?? "0", 10);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

interface WikiData {
  currentPhase: string | null;
  nextActions: string[];
}

function parseWiki(wikiSlug: string): WikiData {
  const file = path.join(WORKSPACE_ROOT, "wiki", `${wikiSlug}.md`);
  if (!fs.existsSync(file)) return { currentPhase: null, nextActions: [] };
  const raw = fs.readFileSync(file, "utf-8");
  let currentPhase: string | null = null;
  const statusMatch = raw.match(/##\s+Status\s*\n+([^\n]+)/);
  if (statusMatch) {
    currentPhase = statusMatch[1].replace(/^[\s✅🔄⬜⚒⚑▶▸·\-—]+/, "").trim().slice(0, 60);
  }
  const nextActions = raw
    .split("\n")
    .filter((l) => /^\s*[-*]\s*⬜/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s*⬜\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 5);
  return { currentPhase, nextActions };
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `oklch(0.72 0.16 ${hue})`;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function inferStack(repo: GitHubRepo): string[] {
  const stack = new Set<string>();
  if (repo.language) stack.add(repo.language);
  for (const t of repo.topics ?? []) stack.add(t);
  return Array.from(stack).slice(0, 6);
}

function inferStage(repo: GitHubRepo): Stage {
  if (repo.archived) return "prod";
  const t = (repo.topics ?? []).map((x) => x.toLowerCase());
  if (t.includes("production") || t.includes("prod")) return "prod";
  if (t.includes("uat") || t.includes("staging")) return "uat";
  if (t.includes("idea") || t.includes("draft")) return "idea";
  return "dev";
}

function projectIdFor(repo: GitHubRepo): string {
  // Owner-prefixed so a personal `foo` and a REECE `foo` don't collide.
  return `${slugify(repo.owner.login)}--${slugify(repo.name)}`;
}

function buildProjectShell(repo: GitHubRepo, tokenEnvVar: string, accountLabel: string): DiscoveredProject {
  const id = projectIdFor(repo);
  const slug = repo.name.toLowerCase();
  return {
    id,
    name: repo.name,
    displayName: `${repo.owner.login}/${repo.name}`,
    stage: inferStage(repo),
    stack: inferStack(repo),
    health: "green",
    currentPhase: "",
    phaseProgress: 0,
    lastCommit: { hash: "", message: "", age: relativeAge(repo.pushed_at) },
    description: repo.description ?? "",
    legalFlags: [],
    nextActions: [],
    color: colorFor(repo.full_name),
    repo: repo.full_name,
    account: accountLabel,
    owner: repo.owner.login,
    defaultBranch: repo.default_branch,
    tokenEnvVar,
    wikiSlug: slug,
    memoryProject: slug,
  };
}

function repoSignature(list: DiscoveredProject[]): string {
  return list.map((p) => p.id).sort().join("|");
}

function broadcastProjectsSet(broadcast: (m: ServerMessage) => void, list: DiscoveredProject[]): void {
  const msg: ServerMessage = {
    type: "projects_set",
    projects: list.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      stage: p.stage,
      stack: p.stack,
      health: p.health,
      currentPhase: p.currentPhase,
      phaseProgress: p.phaseProgress,
      lastCommit: p.lastCommit,
      description: p.description,
      legalFlags: p.legalFlags,
      nextActions: p.nextActions,
      color: p.color,
      repo: p.repo,
      account: p.account,
      owner: p.owner,
    })),
  };
  broadcast(msg);
}

interface ProjectUpdate {
  projectId: string;
  lastCommit?: CommitInfo;
  memoryCount?: number;
  currentPhase?: string;
  nextActions?: string[];
  // STATUS.md-derived (only present when the file exists in the repo):
  summary?: string;
  phaseProgress?: number;
  status?: string;          // active | paused | done | archived
  nextSteps?: NextStep[];
  milestones?: Milestone[];
  hasStatusFile?: boolean;
}

// Per-project parsed STATUS.md, kept in module scope so the scheduler can
// pull from all projects in one pass.
const parsedByProject = new Map<string, ParsedStatus>();

async function buildUpdate(p: DiscoveredProject, accounts: TokenAccount[]): Promise<ProjectUpdate> {
  const acct = accounts.find((a) => a.envVar === p.tokenEnvVar);
  const token = acct?.token ?? "";
  const [commit, memoryCount, initialStatusText] = await Promise.all([
    fetchLastCommit(token, p.repo, p.defaultBranch),
    p.memoryProject ? fetchMemoryCount(p.memoryProject) : Promise.resolve(0),
    fetchStatusFile(token, p.repo),
  ]);
  let statusText = initialStatusText;
  if (!statusText && AUTO_STATUS_BOOTSTRAP && token && acct) {
    const ensured = await ensureStatusFileForRepo(token, acct.label, projectToRepoInput(p));
    if (ensured.result === "committed" || ensured.result === "skipped-already-exists") {
      statusText = await fetchStatusFile(token, p.repo);
      console.log(`[project-state] auto-status ${ensured.result}: ${p.repo}`);
    } else if (ensured.result === "failed") {
      console.warn(`[project-state] auto-status failed for ${p.repo}: ${ensured.detail ?? "unknown error"}`);
    }
  }
  const update: ProjectUpdate = { projectId: p.id, memoryCount };
  if (commit) update.lastCommit = commit;

  if (statusText) {
    if (AUTO_STATUS_SYNC && commit && token) {
      const syncResult = await syncStatusFileMetadataForRepo(token, projectToRepoInput(p), {
        hash: commit.hash,
        message: commit.message,
      });
      if (syncResult === "synced") {
        statusText = await fetchStatusFile(token, p.repo) ?? statusText;
        console.log(`[project-state] status metadata synced: ${p.repo} @ ${commit.hash}`);
      } else if (syncResult === "failed") {
        console.warn(`[project-state] status metadata sync failed: ${p.repo}`);
      }
    }
    const parsed = parseStatusMd(statusText, p.id);
    parsedByProject.set(p.id, parsed);
    update.hasStatusFile = true;
    update.summary = parsed.summary || undefined;
    update.phaseProgress = parsed.phaseProgress;
    update.status = parsed.status;
    if (parsed.phase) update.currentPhase = parsed.phase;
    if (parsed.nextSteps.length) {
      update.nextSteps = parsed.nextSteps;
      update.nextActions = parsed.nextSteps.filter((t) => !t.done).slice(0, 5).map((t) => t.title);
    }
    if (parsed.milestones.length) update.milestones = parsed.milestones;
  } else {
    parsedByProject.delete(p.id);
    update.hasStatusFile = false;
    // Fall back to wiki-derived fields if no status file (legacy behavior).
    const wiki = p.wikiSlug ? parseWiki(p.wikiSlug) : { currentPhase: null, nextActions: [] };
    if (wiki.currentPhase) update.currentPhase = wiki.currentPhase;
    if (wiki.nextActions.length) update.nextActions = wiki.nextActions;
  }
  return update;
}

function buildSchedule(): ScheduledEvent[] {
  const projs: SchedulableProject[] = [];
  for (const p of discovered) {
    const parsed = parsedByProject.get(p.id);
    if (!parsed) continue;
    projs.push({
      id: p.id,
      name: p.displayName || p.name,
      color: p.color,
      status: parsed.status,
      nextSteps: parsed.nextSteps,
    });
  }
  return scheduleProjects(projs);
}

function projectToRepoInput(p: DiscoveredProject): GitHubRepo {
  return {
    id: 0,
    name: p.name,
    full_name: p.repo,
    owner: { login: p.owner },
    description: p.description || null,
    language: p.stack[0] ?? null,
    topics: p.stack.slice(1),
    default_branch: p.defaultBranch,
    pushed_at: new Date().toISOString(),
    archived: false,
    fork: false,
  };
}

function broadcastUpdate(broadcast: (m: ServerMessage) => void, u: ProjectUpdate): void {
  broadcast({ type: "project_update", projectId: u.projectId, updates: u } as ServerMessage);
}

let lastAccounts: TokenAccount[] = [];

/** Send the *current* discovered list to one client (or broadcast). Used on
 *  WS connection so a fresh tab always gets the project cards immediately,
 *  regardless of whether discovery is in flight or unchanged-since-cache. */
export function sendProjectsSnapshot(send: (m: ServerMessage) => void): void {
  if (discovered.length === 0) return;
  broadcastProjectsSet(send, discovered);
}

/** Discover repos across all configured GitHub accounts, broadcast set if
 *  changed, then per-repo enrichment using each repo's owning token. */
export async function broadcastInitialProjectStates(broadcast: (m: ServerMessage) => void): Promise<void> {
  const accounts = await loadTokenAccounts();
  lastAccounts = accounts;
  if (accounts.length === 0 && !GITHUB_USER_ENV) {
    console.log("[project-state] no GitHub tokens or GITHUB_USER configured — skipping discovery");
    return;
  }
  console.log(`[project-state] discovering with accounts: ${accounts.map((a) => `${a.label}=${a.login ?? '?'}`).join(", ") || "(none, public-only fallback)"}`);

  const seen = new Map<string, DiscoveredProject>();
  if (accounts.length > 0) {
    for (const acct of accounts) {
      const repos = await listReposForToken(acct.token);
      for (const r of repos) {
        if (r.fork) continue;
        const shell = buildProjectShell(r, acct.envVar, acct.label);
        // Dedupe by full_name; first-seen wins (so a personal token's view of
        // an org repo doesn't get clobbered by the work token, and vice versa).
        if (!seen.has(shell.repo)) seen.set(shell.repo, shell);
      }
    }
  } else if (GITHUB_USER_ENV) {
    const repos = await listPublicReposForUser(GITHUB_USER_ENV);
    for (const r of repos) {
      if (r.fork) continue;
      const shell = buildProjectShell(r, "", "public"); // no token — public-only enrichment
      if (!seen.has(shell.repo)) seen.set(shell.repo, shell);
    }
  }

  const next = Array.from(seen.values());
  console.log(`[project-state] discovered ${next.length} repos`);

  const sig = repoSignature(next);
  if (sig !== lastRepoSignature) {
    discovered = next;
    lastRepoSignature = sig;
    broadcastProjectsSet(broadcast, discovered);
    console.log(`[project-state] broadcast projects_set (${discovered.length} projects)`);
  } else {
    discovered = next; // refresh defaultBranch / token mapping silently
  }

  const updates = await Promise.all(discovered.map((p) => buildUpdate(p, accounts)));
  for (const u of updates) broadcastUpdate(broadcast, u);

  // Run scheduler over all projects that have parsed STATUS.md data and
  // broadcast the resulting calendar. Empty payload is fine — the frontend
  // shows an empty-state card explaining bootstrap is needed.
  lastSchedule = buildSchedule();
  broadcast({ type: "calendar_set", events: lastSchedule } as ServerMessage);
  console.log(`[project-state] scheduled ${lastSchedule.length} events from ${parsedByProject.size} status files`);
}

/** Snapshot of the most recent scheduler output, sent to newly connected
 *  clients so the calendar lights up immediately on tab open. */
let lastSchedule: ScheduledEvent[] = [];
export function sendCalendarSnapshot(send: (m: ServerMessage) => void): void {
  send({ type: "calendar_set", events: lastSchedule } as ServerMessage);
}

/** Re-broadcast one project (used by file-watcher when its wiki changes). */
export async function refreshOneProject(
  broadcast: (m: ServerMessage) => void,
  projectIdOrWikiSlug: string,
): Promise<void> {
  const p = discovered.find((x) => x.id === projectIdOrWikiSlug || x.wikiSlug === projectIdOrWikiSlug);
  if (!p) return;
  const u = await buildUpdate(p, lastAccounts);
  broadcastUpdate(broadcast, u);
  lastSchedule = buildSchedule();
  broadcast({ type: "calendar_set", events: lastSchedule } as ServerMessage);
}

/** Polling loop — picks up newly created/deleted GitHub repos and commit refreshes. */
export function startProjectStateRefresh(broadcast: (m: ServerMessage) => void): NodeJS.Timeout {
  return setInterval(() => {
    broadcastInitialProjectStates(broadcast).catch((e) => {
      console.error("[project-state] refresh failed:", e?.message ?? e);
    });
  }, REFRESH_MS);
}

/** Lookup by file path (for the chokidar handler). */
export function wikiSlugFromPath(filePath: string): string | null {
  const m = filePath.match(/\/wiki\/([^/]+)\.md$/);
  if (!m) return null;
  return discovered.some((p) => p.wikiSlug === m[1]) ? m[1] : null;
}

/** Snapshot of currently discovered repos in the shape wiki-sync expects.
 *  Exposed so the wiki→.janus/status.md sync can target real GitHub repos
 *  without re-doing a full discovery round-trip. */
export function discoveredReposForSync(): Array<{ full_name: string; name: string; owner: string; default_branch: string; archived: boolean; fork: boolean }> {
  return discovered.map((p) => ({
    full_name: p.repo,
    name: p.name,
    owner: p.owner,
    default_branch: p.defaultBranch,
    archived: false,
    fork: false,
  }));
}

/** Diagnostic snapshot for /api/projects/state — which accounts loaded,
 *  which repos were discovered, and (per project) whether STATUS.md was
 *  parsed plus how many next steps / milestones / scheduled events it
 *  contributed. Use this to diagnose "why is everything empty?" in one shot. */
export function projectStateSnapshot(): {
  tokenSources: Array<{ envVar: string; label: string; presentInProcessEnv: boolean; presentInDotfiles: boolean }>;
  accounts: Array<{ envVar: string; label: string; login: string | null }>;
  discoveredCount: number;
  byAccount: Record<string, number>;
  withStatusFile: number;
  withoutStatusFile: number;
  totalNextSteps: number;
  totalMilestones: number;
  totalScheduledEvents: number;
  projects: Array<{
    id: string; repo: string; account: string; owner: string; defaultBranch: string;
    hasStatusFile: boolean;
    summary: string | null;
    phase: string | null;
    phaseProgress: number | null;
    statusValue: string | null;
    nextStepsOpen: number;
    nextStepsDone: number;
    milestones: number;
    scheduledEvents: number;
    parsedNextStepTitles: string[];
  }>;
} {
  const tokenSources = GITHUB_TOKEN_SOURCES.map((s) => {
    const proc = process.env[s.envVar] ?? "";
    return {
      envVar: s.envVar,
      label: s.label,
      presentInProcessEnv: proc.length > 0,
      presentInDotfiles: !proc && !!readVarFromDotfiles(s.envVar),
    };
  });
  const byAccount: Record<string, number> = {};
  for (const p of discovered) byAccount[p.account] = (byAccount[p.account] ?? 0) + 1;

  // Count how many scheduled events landed for each project.
  const schedByProject = new Map<string, number>();
  for (const ev of lastSchedule) {
    schedByProject.set(ev.projectId, (schedByProject.get(ev.projectId) ?? 0) + 1);
  }

  let withStatusFile = 0;
  let totalNextSteps = 0;
  let totalMilestones = 0;
  const projects = discovered.map((p) => {
    const parsed = parsedByProject.get(p.id);
    const has = !!parsed;
    if (has) withStatusFile++;
    const open = parsed ? parsed.nextSteps.filter((t) => !t.done).length : 0;
    const done = parsed ? parsed.nextSteps.filter((t) => t.done).length : 0;
    totalNextSteps += open;
    totalMilestones += parsed?.milestones.length ?? 0;
    return {
      id: p.id,
      repo: p.repo,
      account: p.account,
      owner: p.owner,
      defaultBranch: p.defaultBranch,
      hasStatusFile: has,
      summary: parsed?.summary || null,
      phase: parsed?.phase || null,
      phaseProgress: parsed ? parsed.phaseProgress : null,
      statusValue: parsed?.status || null,
      nextStepsOpen: open,
      nextStepsDone: done,
      milestones: parsed?.milestones.length ?? 0,
      scheduledEvents: schedByProject.get(p.id) ?? 0,
      parsedNextStepTitles: parsed ? parsed.nextSteps.filter((t) => !t.done).slice(0, 5).map((t) => t.title) : [],
    };
  });
  return {
    tokenSources,
    accounts: lastAccounts.map((a) => ({ envVar: a.envVar, label: a.label, login: a.login })),
    discoveredCount: discovered.length,
    byAccount,
    withStatusFile,
    withoutStatusFile: discovered.length - withStatusFile,
    totalNextSteps,
    totalMilestones,
    totalScheduledEvents: lastSchedule.length,
    projects,
  };
}
