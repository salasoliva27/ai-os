// Bootstrap `.janus/status.md` across the user's GitHub repos.
//
// The bridge enumerates every owned repo across all configured GitHub
// accounts (see project-state.ts → GITHUB_TOKEN_SOURCES) and, for each one
// without a `.janus/status.md`, creates a starter file. Default mode is
// "pr" — opens one PR per repo on a deterministic branch (`janus/bootstrap-
// status`) so reruns don't pile up branches. "commit" mode pushes straight
// to the default branch.
//
// Idempotent: skips repos that already have the file. If a previous run left
// a branch behind without an open PR, this run reuses the branch and reopens
// the PR.

import { readVarFromDotfiles } from "./agent-registry.js";

const GITHUB_TOKEN_SOURCES: Array<{ envVar: string; label: string }> = [
  { envVar: "GITHUB_TOKEN", label: "personal" },
  { envVar: "GITHUB_TOKEN_REECE", label: "reece" },
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
    "User-Agent": "janus-bootstrap-status",
  };
}

async function listOwnedRepos(token: string): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = [];
  let next: string | null =
    "https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed";
  while (next && out.length < 500) {
    const r: Response = await fetch(next, { headers: ghHeaders(token), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) break;
    const page = (await r.json()) as GitHubRepo[];
    out.push(...page);
    const link: string = r.headers.get("link") || "";
    const m: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
    next = m ? m[1] : null;
  }
  return out;
}

export interface GitHubRepo {
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

function inferStage(repo: GitHubRepo): string {
  if (repo.archived) return "prod";
  const t = (repo.topics ?? []).map((x) => x.toLowerCase());
  if (t.includes("production") || t.includes("prod")) return "prod";
  if (t.includes("uat") || t.includes("staging")) return "uat";
  if (t.includes("idea") || t.includes("draft")) return "idea";
  return "dev";
}

function generateStatusTemplate(repo: GitHubRepo): string {
  const summary = (repo.description ?? `${repo.name} — describe what this project does.`).replace(/"/g, '\\"');
  const stage = inferStage(repo);
  const today = new Date().toISOString().slice(0, 10);
  return `---
status: active
stage: ${stage}
phase: ""
phaseProgress: 0
summary: "${summary}"
---

## Next Steps

<!-- Janus aggregates these across all repos onto the dashboard calendar.
     Format:  - [ ] [P1, 2h] Task title
     Priority: P1 (urgent), P2 (default), P3 (nice-to-have).
     Effort: 30m, 2h, 1d (1d = 6h focused work). -->

- [ ] [P2, 2h] Define the first concrete next step for this project

## Milestones

<!-- Significant moments. Newest first. ISO date — short description. -->

- ${today} — Janus status file created

## Calendar

<!-- AUTO-MANAGED by Janus — do not edit by hand. Schedule round-trips to the
     dashboard calendar UI; edits there are written back here. -->
`;
}

export interface BootstrapItem {
  account: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  result: "skipped-already-exists" | "skipped-archived" | "skipped-name" | "pr-opened" | "pr-existing" | "committed" | "failed";
  detail?: string;
  prUrl?: string;
}

async function repoHasStatusFile(token: string, fullName: string): Promise<boolean> {
  const r = await fetch(`https://api.github.com/repos/${fullName}/contents/.janus/status.md`, {
    headers: ghHeaders(token), signal: AbortSignal.timeout(8_000),
  });
  return r.status === 200;
}

async function getBranchSha(token: string, fullName: string, branch: string): Promise<string | null> {
  const r = await fetch(`https://api.github.com/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token), signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { object?: { sha?: string } };
  return data.object?.sha ?? null;
}

async function createBranch(token: string, fullName: string, branch: string, fromSha: string): Promise<boolean> {
  const r = await fetch(`https://api.github.com/repos/${fullName}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    signal: AbortSignal.timeout(8_000),
  });
  return r.ok;
}

async function getFile(token: string, fullName: string, path: string, branch: string): Promise<{ content: string; sha: string } | null> {
  const r = await fetch(`https://api.github.com/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { content?: string; encoding?: string; sha?: string };
  if (!data.content || !data.sha) return null;
  const content = data.encoding === "base64"
    ? Buffer.from(data.content, "base64").toString("utf-8")
    : data.content;
  return { content, sha: data.sha };
}

async function putFile(token: string, fullName: string, path: string, branch: string, content: string, message: string, sha?: string): Promise<boolean> {
  const body = {
    message,
    branch,
    content: Buffer.from(content, "utf-8").toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(`https://api.github.com/repos/${fullName}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return r.ok;
}

async function findOpenPr(token: string, fullName: string, branch: string, baseBranch: string): Promise<string | null> {
  const owner = fullName.split("/")[0];
  const r = await fetch(
    `https://api.github.com/repos/${fullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(baseBranch)}`,
    { headers: ghHeaders(token), signal: AbortSignal.timeout(8_000) },
  );
  if (!r.ok) return null;
  const list = (await r.json()) as Array<{ html_url?: string }>;
  return list.length > 0 ? (list[0].html_url ?? null) : null;
}

async function openPr(token: string, fullName: string, branch: string, baseBranch: string, title: string, body: string): Promise<string | null> {
  const r = await fetch(`https://api.github.com/repos/${fullName}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head: branch, base: baseBranch }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { html_url?: string };
  return data.html_url ?? null;
}

async function bootstrapRepo(token: string, account: string, repo: GitHubRepo, mode: "pr" | "commit"): Promise<BootstrapItem> {
  const base: BootstrapItem = {
    account, owner: repo.owner.login, repo: repo.full_name, defaultBranch: repo.default_branch, result: "failed",
  };
  if (repo.archived) return { ...base, result: "skipped-archived", detail: "repo is archived" };
  if (repo.fork) return { ...base, result: "skipped-name", detail: "repo is a fork" };

  try {
    if (await repoHasStatusFile(token, repo.full_name)) {
      return { ...base, result: "skipped-already-exists", detail: ".janus/status.md already exists" };
    }
  } catch (err) {
    return { ...base, result: "failed", detail: `existence check failed: ${String(err)}` };
  }

  const content = generateStatusTemplate(repo);
  const commitMsg = "chore(janus): bootstrap .janus/status.md\n\nGenerated by Janus IA so the dashboard can track this project's progress, next steps, and calendar.";

  if (mode === "commit") {
    const ok = await putFile(token, repo.full_name, ".janus/status.md", repo.default_branch, content, commitMsg);
    return ok
      ? { ...base, result: "committed", detail: `committed to ${repo.default_branch}` }
      : { ...base, result: "failed", detail: "PUT contents failed" };
  }

  // PR mode
  const branch = "janus/bootstrap-status";
  const baseSha = await getBranchSha(token, repo.full_name, repo.default_branch);
  if (!baseSha) return { ...base, result: "failed", detail: `couldn't read base branch ${repo.default_branch}` };

  // Reuse existing branch if present, else create.
  const existingBranchSha = await getBranchSha(token, repo.full_name, branch);
  if (!existingBranchSha) {
    const created = await createBranch(token, repo.full_name, branch, baseSha);
    if (!created) return { ...base, result: "failed", detail: `couldn't create branch ${branch}` };
  }

  const wrote = await putFile(token, repo.full_name, ".janus/status.md", branch, content, commitMsg);
  if (!wrote) return { ...base, result: "failed", detail: "PUT contents failed on PR branch" };

  const existingPr = await findOpenPr(token, repo.full_name, branch, repo.default_branch);
  if (existingPr) return { ...base, result: "pr-existing", detail: "PR already open", prUrl: existingPr };

  const url = await openPr(
    token, repo.full_name, branch, repo.default_branch,
    "chore(janus): bootstrap .janus/status.md",
    "Generated by Janus IA. This file lets the dashboard track project status, next steps, milestones, and a Janus-managed calendar block.\n\n- Edit `Next Steps` and `Milestones` as you work.\n- Don't edit the `Calendar` section by hand — it's auto-managed.\n- Schema: https://github.com/salasoliva27/janus-ia/blob/main/docs/status-md-schema.md",
  );
  return url
    ? { ...base, result: "pr-opened", detail: "PR opened on default branch", prUrl: url }
    : { ...base, result: "failed", detail: "openPr returned no URL" };
}

export async function ensureStatusFileForRepo(token: string, account: string, repo: GitHubRepo): Promise<BootstrapItem> {
  return bootstrapRepo(token, account, repo, "commit");
}

function setFrontmatterField(text: string, key: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const line = `${key}: "${escaped}"`;
  const block = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!block) return `---\n${line}\n---\n\n${text}`;
  const body = block[1];
  const re = new RegExp(`^${key}:.*$`, "m");
  const nextBody = re.test(body) ? body.replace(re, line) : `${body.trimEnd()}\n${line}`;
  return text.replace(/^---\s*\n[\s\S]*?\n---/, `---\n${nextBody}\n---`);
}

export async function syncStatusFileMetadataForRepo(
  token: string,
  repo: GitHubRepo,
  latestCommit: { hash: string; message: string },
): Promise<"synced" | "skipped" | "missing" | "failed"> {
  const current = await getFile(token, repo.full_name, ".janus/status.md", repo.default_branch);
  if (!current) return "missing";
  if (current.content.includes(`lastSyncedCommit: "${latestCommit.hash}"`)) return "skipped";
  let next = setFrontmatterField(current.content, "lastSyncedAt", new Date().toISOString());
  next = setFrontmatterField(next, "lastSyncedCommit", latestCommit.hash);
  next = setFrontmatterField(next, "lastSyncedCommitMessage", latestCommit.message);
  const ok = await putFile(
    token,
    repo.full_name,
    ".janus/status.md",
    repo.default_branch,
    next,
    "chore(janus): sync status metadata\n\nRecords the latest non-Janus commit observed by the dashboard.",
    current.sha,
  );
  return ok ? "synced" : "failed";
}

export interface BootstrapSummary {
  totalRepos: number;
  byAccount: Record<string, number>;
  byResult: Record<string, number>;
  items: BootstrapItem[];
}

export async function bootstrapAllRepos(opts: { mode: "pr" | "commit"; dryRun?: boolean }): Promise<BootstrapSummary> {
  const tokens: Array<{ label: string; token: string }> = [];
  for (const src of GITHUB_TOKEN_SOURCES) {
    const t = envOrDotfile(src.envVar);
    if (t) tokens.push({ label: src.label, token: t });
  }

  const items: BootstrapItem[] = [];
  const seen = new Set<string>();
  for (const tk of tokens) {
    const repos = await listOwnedRepos(tk.token);
    for (const r of repos) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      if (opts.dryRun) {
        items.push({
          account: tk.label, owner: r.owner.login, repo: r.full_name, defaultBranch: r.default_branch,
          result: "skipped-name", detail: "dry-run: would bootstrap",
        });
        continue;
      }
      const item = await bootstrapRepo(tk.token, tk.label, r, opts.mode);
      items.push(item);
    }
  }

  const byAccount: Record<string, number> = {};
  const byResult: Record<string, number> = {};
  for (const i of items) {
    byAccount[i.account] = (byAccount[i.account] ?? 0) + 1;
    byResult[i.result] = (byResult[i.result] ?? 0) + 1;
  }
  return { totalRepos: items.length, byAccount, byResult, items };
}
