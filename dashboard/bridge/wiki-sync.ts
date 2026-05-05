// Wiki → repo `.janus/status.md` sync.
//
// Source of truth: `wiki/<slug>.md` files in this janus-ia repo (which the
// user maintains by hand). Derived artifact: each project's repo gets a
// `.janus/status.md` generated from its wiki, committed directly to the
// default branch. The generator never produces any literal status text — all
// content (summary, next steps, milestones, progress) is extracted from the
// wiki the user wrote.
//
// Triggered:
//   1. On bridge startup (after first project discovery).
//   2. On every wiki/<slug>.md change (chokidar in file-watcher.ts).
//   3. On the 5-minute discovery refresh.
//
// Idempotent: only commits when the generated content differs from what the
// repo already has, so repeat runs are no-ops and don't pollute git history.

import * as fs from "node:fs";
import * as path from "node:path";
import { readVarFromDotfiles } from "./agent-registry.js";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/workspaces/janus-ia";
const WIKI_DIR = path.join(WORKSPACE_ROOT, "wiki");

const GITHUB_TOKEN_SOURCES: Array<{ envVar: string; ownerLogin?: string }> = [
  { envVar: "GITHUB_TOKEN" },
  { envVar: "GITHUB_TOKEN_REECE" },
];

function envOrDotfile(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  return readVarFromDotfiles(name) ?? "";
}

function ghHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "janus-wiki-sync",
  };
}

interface ParsedWiki {
  project: string;            // frontmatter `project:`
  updated: string | null;     // frontmatter `updated:` (YYYY-MM-DD)
  summary: string;            // first non-blank line under the # heading
  status: string;             // text under `## Status`
  openSteps: string[];        // ⬜ items, in document order
  completedItems: string[];   // ✅ items, most-recent-first by document order
  legalFlag: string | null;
}

function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    let val = kv[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[kv[1]] = val;
  }
  return out;
}

function summaryFromBody(text: string): string {
  // First non-empty paragraph after the first `# heading` and before the next `## section`.
  const stripped = text.replace(/^---[\s\S]*?\n---\s*\n/, "");
  const afterTitle = stripped.replace(/^#\s+[^\n]*\n+/, "");
  const beforeSection = afterTitle.split(/\n##\s/)[0];
  const firstPara = beforeSection.split(/\n\s*\n/)[0]?.trim() ?? "";
  return firstPara.replace(/\s+/g, " ");
}

function sectionBody(text: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  return text.match(re)?.[1] ?? "";
}

function parseWiki(text: string): ParsedWiki {
  const fm = parseFrontmatter(text);
  const summary = summaryFromBody(text);

  const statusBody = sectionBody(text, "Status");
  const status = statusBody.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";

  // Walk the whole document for ⬜ and ✅ markers (they live across multiple
  // sections in real wikis, e.g. "POC done", "Build done", "Still broken").
  const openSteps: string[] = [];
  const completedItems: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    let m = line.match(/^\s*[-*]\s*⬜\s+(.+?)\s*$/);
    if (m) { openSteps.push(m[1]); continue; }
    m = line.match(/^\s*[-*]\s*✅\s+(.+?)\s*$/);
    if (m) { completedItems.push(m[1]); continue; }
  }

  const legalBody = sectionBody(text, "Legal flag");
  const legalFlag = legalBody.split("\n").map((l) => l.trim()).filter(Boolean)[0] || null;

  return {
    project: fm.project ?? "",
    updated: fm.updated ?? null,
    summary,
    status,
    openSteps,
    completedItems,
    legalFlag,
  };
}

interface CandidateRepo {
  full_name: string;
  name: string;
  owner: string;
  default_branch: string;
  archived: boolean;
  fork: boolean;
}

/** Match a wiki's `project:` slug to one of the discovered repos. Tries:
 *    1. Exact name match.
 *    2. Repo name starts with wiki slug (e.g. wiki=`nutria` matches `nutria-app-dev`).
 *    3. Repo name contains wiki slug.
 *  Among matches, prefer non-archived non-fork; tie-break by shortest name. */
export function matchWikiToRepo(wikiProject: string, repos: CandidateRepo[]): CandidateRepo | null {
  if (!wikiProject) return null;
  const slug = wikiProject.toLowerCase();
  const candidates = repos.filter((r) => !r.archived && !r.fork);
  const exact = candidates.filter((r) => r.name.toLowerCase() === slug);
  if (exact.length) return exact[0];
  const prefix = candidates.filter((r) => r.name.toLowerCase().startsWith(slug));
  if (prefix.length) return prefix.sort((a, b) => a.name.length - b.name.length)[0];
  const contains = candidates.filter((r) => r.name.toLowerCase().includes(slug));
  if (contains.length) return contains.sort((a, b) => a.name.length - b.name.length)[0];
  return null;
}

const HEADER_COMMENT = "<!-- AUTO-GENERATED by Janus from wiki/<slug>.md. Do not edit by hand — your changes will be overwritten on the next sync. -->";

export function generateStatusMd(parsed: ParsedWiki): string {
  const updated = parsed.updated || new Date().toISOString().slice(0, 10);
  const total = parsed.openSteps.length + parsed.completedItems.length;
  const phaseProgress = total > 0 ? +(parsed.completedItems.length / total).toFixed(2) : 0;

  // Extract a `phase` from the Status line by stripping leading emoji and
  // taking the first 60 chars. Keeps the dashboard tile concise.
  const phase = parsed.status
    .replace(/^[\s✅🔄⬜⚒⚑▶▸·\-—✓]+/, "")
    .trim()
    .slice(0, 60);

  const summary = (parsed.summary || `Project ${parsed.project}.`).replace(/"/g, '\\"');

  const nextStepLines = parsed.openSteps.length
    ? parsed.openSteps.map((title) => `- [ ] [P2, 2h] ${title}`).join("\n")
    : "<!-- No open ⬜ items in the wiki yet. -->";

  const milestoneLines = parsed.completedItems.length
    ? parsed.completedItems.slice(0, 20).map((title) => `- ${updated} — ${title}`).join("\n")
    : "<!-- No ✅ items in the wiki yet. -->";

  const legalNote = parsed.legalFlag ? `\n\n## Legal flag\n\n${parsed.legalFlag}` : "";

  return `${HEADER_COMMENT}
---
status: active
stage: dev
phase: "${phase}"
phaseProgress: ${phaseProgress}
summary: "${summary}"
---

## Next Steps

${nextStepLines}

## Milestones

${milestoneLines}

## Calendar

<!-- AUTO-MANAGED by the Janus scheduler — do not edit by hand. Schedule
     round-trips to the dashboard calendar UI; edits there are written back
     into the source wiki, which then re-renders this file. -->${legalNote}
`;
}

async function getRemoteFile(token: string, fullName: string, branch: string): Promise<{ content: string; sha: string } | null> {
  const r = await fetch(`https://api.github.com/repos/${fullName}/contents/.janus/status.md?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token), signal: AbortSignal.timeout(8_000),
  });
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const data = (await r.json()) as { content?: string; encoding?: string; sha?: string };
  if (!data.content || !data.sha) return null;
  const content = data.encoding === "base64"
    ? Buffer.from(data.content, "base64").toString("utf-8")
    : data.content;
  return { content, sha: data.sha };
}

async function putFile(token: string, fullName: string, branch: string, content: string, message: string, sha?: string): Promise<{ ok: boolean; error?: string }> {
  const body = {
    message,
    branch,
    content: Buffer.from(content, "utf-8").toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(`https://api.github.com/repos/${fullName}/contents/.janus/status.md`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (r.ok) return { ok: true };
  const errText = await r.text().catch(() => "");
  return { ok: false, error: `${r.status}: ${errText.slice(0, 200)}` };
}

export interface SyncResult {
  wiki: string;
  repo: string | null;
  result: "no-match" | "skipped-unchanged" | "committed-new" | "committed-updated" | "failed";
  detail?: string;
}

async function tokensByOwnerLogin(): Promise<Map<string, string>> {
  // Resolve each token's `login` so we know which token owns which repo.
  const map = new Map<string, string>();
  for (const src of GITHUB_TOKEN_SOURCES) {
    const tok = envOrDotfile(src.envVar);
    if (!tok) continue;
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: ghHeaders(tok), signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) continue;
      const u = (await r.json()) as { login?: string };
      if (u.login) map.set(u.login.toLowerCase(), tok);
    } catch { /* skip */ }
  }
  return map;
}

export async function syncOneWiki(wikiFile: string, repos: CandidateRepo[], tokensByLogin?: Map<string, string>): Promise<SyncResult> {
  const tokens = tokensByLogin ?? (await tokensByOwnerLogin());
  const wikiPath = path.isAbsolute(wikiFile) ? wikiFile : path.join(WIKI_DIR, wikiFile);
  const base = path.basename(wikiFile);
  if (!fs.existsSync(wikiPath)) return { wiki: base, repo: null, result: "failed", detail: "wiki file not found" };
  const text = fs.readFileSync(wikiPath, "utf-8");
  const parsed = parseWiki(text);
  if (!parsed.project) return { wiki: base, repo: null, result: "no-match", detail: "wiki has no `project:` frontmatter" };

  const repo = matchWikiToRepo(parsed.project, repos);
  if (!repo) return { wiki: base, repo: null, result: "no-match", detail: `no discovered repo matches '${parsed.project}'` };

  const token = tokens.get(repo.owner.toLowerCase());
  if (!token) return { wiki: base, repo: repo.full_name, result: "failed", detail: `no token available for owner '${repo.owner}'` };

  const generated = generateStatusMd(parsed);
  const remote = await getRemoteFile(token, repo.full_name, repo.default_branch);

  if (remote && remote.content === generated) {
    return { wiki: base, repo: repo.full_name, result: "skipped-unchanged" };
  }

  const isUpdate = !!remote;
  const message = isUpdate
    ? `chore(janus): sync .janus/status.md from wiki/${base}`
    : `chore(janus): bootstrap .janus/status.md from wiki/${base}`;
  const put = await putFile(token, repo.full_name, repo.default_branch, generated, message, remote?.sha);
  if (!put.ok) return { wiki: base, repo: repo.full_name, result: "failed", detail: put.error };
  return {
    wiki: base,
    repo: repo.full_name,
    result: isUpdate ? "committed-updated" : "committed-new",
  };
}

export async function syncAllWikis(repos: CandidateRepo[]): Promise<SyncResult[]> {
  if (repos.length === 0) return [];
  const tokens = await tokensByOwnerLogin();
  if (tokens.size === 0) {
    console.log("[wiki-sync] no GitHub tokens available — skipping");
    return [];
  }
  const wikiFiles = fs.existsSync(WIKI_DIR)
    ? fs.readdirSync(WIKI_DIR).filter((f) => f.endsWith(".md") && f !== "index.md")
    : [];
  const results: SyncResult[] = [];
  for (const wf of wikiFiles) {
    try {
      const r = await syncOneWiki(wf, repos, tokens);
      results.push(r);
    } catch (err) {
      results.push({ wiki: wf, repo: null, result: "failed", detail: String(err) });
    }
  }
  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.result] = (acc[r.result] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[wiki-sync] ${JSON.stringify(summary)} (${results.length} wikis processed)`);
  return results;
}
