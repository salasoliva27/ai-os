import { watch, type FSWatcher } from "chokidar";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ServerMessage } from "./types.js";
import { workspaceStateSlug } from "./path-utils.js";

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/workspaces/janus-ia";
const ENGINE_PROJECT_DIR = workspaceStateSlug(WORKSPACE_ROOT);

const VAULT_PATHS = [
  path.join(WORKSPACE_ROOT, "concepts/**/*.md"),
  path.join(WORKSPACE_ROOT, "learnings/**/*.md"),
  path.join(WORKSPACE_ROOT, "wiki/**/*.md"),
];

const PROJECT_PATHS = [
  path.join(WORKSPACE_ROOT, "projects/**/*.md"),
  path.join(WORKSPACE_ROOT, "agents/**/*.md"),
];

const DASHBOARD_PATHS = [
  path.join(WORKSPACE_ROOT, "dashboard/frontend/src/**/*.{tsx,ts,css}"),
  path.join(WORKSPACE_ROOT, "dashboard/bridge/**/*.ts"),
];

const MEMORY_DIRS = Array.from(new Set([
  path.join(os.homedir(), ".janus", "projects", ENGINE_PROJECT_DIR, "memory"),
  path.join(os.homedir(), ".claude", "projects", ENGINE_PROJECT_DIR, "memory"),
]));

/** Parse a memory .md file into a learning object */
function parseMemoryFile(filePath: string): ServerMessage | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) return null;

    const frontmatter = fmMatch[1];
    const body = fmMatch[2].trim();
    if (!body) return null;

    const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || path.basename(filePath, ".md");
    const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || "";
    const memType = frontmatter.match(/type:\s*(.+)/)?.[1]?.trim() || "project";

    // Only feedback and project types become behavioral learnings
    // user and reference types are context, not behavioral changes
    if (memType !== "feedback" && memType !== "project") return null;

    // Extract the rule (first line or sentence of body)
    const lines = body.split("\n").filter((l) => l.trim() && !l.startsWith("**"));
    const rule = lines[0]?.slice(0, 160) || description;

    const domain =
      memType === "feedback"
        ? "pattern"
        : name.includes("market")
          ? "market"
          : name.includes("legal")
            ? "legal"
            : name.includes("gtm")
              ? "gtm"
              : "technical";

    const stat = fs.statSync(filePath);

    return {
      type: "learning_update",
      learning: {
        id: `mem-${path.basename(filePath, ".md")}`,
        rule,
        content: body.length > 300 ? body.slice(0, 300) + "..." : body,
        domain,
        project: "all",
        timestamp: stat.mtimeMs,
        sourceMemoryIds: [`file:${path.basename(filePath)}`],
        status: "active",
      },
    };
  } catch {
    return null;
  }
}

/** Parse a vault learnings/concepts .md file into a learning object */
function parseVaultFile(filePath: string): ServerMessage | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const basename = path.basename(filePath, ".md");
    const isLearning = filePath.includes("/learnings/");
    const isConcept = filePath.includes("/concepts/");
    if (!isLearning && !isConcept) return null;

    // Parse frontmatter if present
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const frontmatter = fmMatch?.[1] || "";
    const body = fmMatch ? fmMatch[2].trim() : raw.trim();

    // Use frontmatter description as rule (it's the best summary)
    const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim();

    // Fallback: first non-header, non-empty line from body
    const bodyLines = body
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));
    const rule = description || bodyLines[0]?.slice(0, 160) || `${basename} updated`;

    // Detect domain from frontmatter tags or filename
    const tags = frontmatter.match(/tags:\s*\[([^\]]*)\]/)?.[1] || "";
    const domain = (tags.includes("market") || basename.includes("market"))
      ? "market"
      : (tags.includes("legal") || basename.includes("legal"))
        ? "legal"
        : (tags.includes("gtm") || basename.includes("gtm"))
          ? "gtm"
          : (tags.includes("pattern") || tags.includes("strategy") || basename.includes("pattern"))
            ? "pattern"
            : "technical";

    const stat = fs.statSync(filePath);

    return {
      type: "learning_update",
      learning: {
        id: `vault-${basename}`,
        rule,
        content: body.length > 300 ? body.slice(0, 300) + "..." : body,
        domain,
        project: "all",
        timestamp: stat.mtimeMs,
        sourceMemoryIds: [`vault:${basename}`],
        status: "active",
      },
    };
  } catch {
    return null;
  }
}

/** Scan existing files and broadcast initial learnings */
export function broadcastInitialLearnings(broadcast: (msg: ServerMessage) => void): void {
  // Scan auto-memory files
  const seenMemory = new Set<string>();
  for (const memoryDir of MEMORY_DIRS.filter(dir => fs.existsSync(dir))) {
    for (const f of fs.readdirSync(memoryDir)) {
      if (seenMemory.has(f)) continue;
      seenMemory.add(f);
      if (!f.endsWith(".md") || f === "MEMORY.md") continue;
      const msg = parseMemoryFile(path.join(memoryDir, f));
      if (msg) broadcast(msg);
    }
  }

  // Scan vault learnings
  const learningsDir = path.join(WORKSPACE_ROOT, "learnings");
  if (fs.existsSync(learningsDir)) {
    for (const f of fs.readdirSync(learningsDir)) {
      if (!f.endsWith(".md")) continue;
      const msg = parseVaultFile(path.join(learningsDir, f));
      if (msg) broadcast(msg);
    }
  }

  // Scan vault concepts
  const conceptsDir = path.join(WORKSPACE_ROOT, "concepts");
  if (fs.existsSync(conceptsDir)) {
    for (const f of fs.readdirSync(conceptsDir)) {
      if (!f.endsWith(".md")) continue;
      const msg = parseVaultFile(path.join(conceptsDir, f));
      if (msg) broadcast(msg);
    }
  }
}

export function startWatchers(broadcast: (msg: ServerMessage) => void): FSWatcher[] {
  const vaultWatcher = watch([...VAULT_PATHS, ...PROJECT_PATHS, ...DASHBOARD_PATHS], {
    ignoreInitial: true,
    ignored: /(node_modules|\.git|^\.)/,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  vaultWatcher.on("all", (event: string, filePath: string) => {
    broadcast({ type: "fs_event", event, path: filePath, timestamp: Date.now() });

    // Also emit as learning if it's a learnings/ or concepts/ file
    if (event === "change" || event === "add") {
      const msg = parseVaultFile(filePath);
      if (msg) broadcast(msg);
    }
  });

  vaultWatcher.on("ready", () => {
    console.log("[watcher] watching vault and project directories");
  });

  // Watch auto-memory directory for live changes
  const watchers: FSWatcher[] = [vaultWatcher];

  for (const memoryDir of MEMORY_DIRS.filter(dir => fs.existsSync(dir))) {
    const memWatcher = watch(path.join(memoryDir, "**/*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });

    memWatcher.on("all", (event: string, filePath: string) => {
      if (event === "change" || event === "add") {
        const msg = parseMemoryFile(filePath);
        if (msg) broadcast(msg);
      }
    });

    memWatcher.on("ready", () => {
      console.log("[watcher] watching auto-memory directory");
    });

    watchers.push(memWatcher);
  }

  return watchers;
}

export async function stopWatchers(watchers: FSWatcher[]): Promise<void> {
  await Promise.all(watchers.map((w) => w.close()));
}
