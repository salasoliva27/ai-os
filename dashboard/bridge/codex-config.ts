import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type McpSpec = {
  type?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

type McpConfig = {
  mcpServers?: Record<string, McpSpec>;
};

const MANAGED_LABEL = "janus-ia codex mcp sync";
const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/i;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function collectEnvRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) refs.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectEnvRefs(item, refs);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectEnvRefs(item, refs);
  }
  return refs;
}

function resolveNonSecretEnvRefs(value: string): { value: string; ok: true } | { ok: false; reason: string } {
  let ok = true;
  let reason = "";
  const next = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name) => {
    if (SECRETISH.test(name)) {
      ok = false;
      reason = `refuses to write secret-like env var ${name} into config`;
      return "";
    }
    const resolved = process.env[name];
    if (!resolved) {
      ok = false;
      reason = `missing ${name}`;
      return "";
    }
    return resolved;
  });
  return ok ? { ok: true, value: next } : { ok: false, reason };
}

function stripManagedBlock(content: string, workspaceRoot: string): string {
  const start = `# >>> ${MANAGED_LABEL}: ${workspaceRoot}`;
  const end = `# <<< ${MANAGED_LABEL}: ${workspaceRoot}`;
  const startIdx = content.indexOf(start);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(end, startIdx);
  if (endIdx === -1) return content;
  return `${content.slice(0, startIdx).trimEnd()}\n\n${content.slice(endIdx + end.length).trimStart()}`.trimEnd() + "\n";
}

function hasManualMcpServer(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = new RegExp(`^\\[mcp_servers\\.${escaped}\\]`, "m");
  const quoted = new RegExp(`^\\[mcp_servers\\.${tomlString(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "m");
  return bare.test(content) || quoted.test(content);
}

function stdioServerBlock(name: string, workspaceRoot: string, dashHome: string, spec: McpSpec): string {
  const shim = path.join(dashHome, "scripts", "codex-mcp-shim.js");
  const refs = Array.from(collectEnvRefs(spec.env ?? {})).sort();
  const lines = [
    `[mcp_servers.${tomlKey(name)}]`,
    `command = "node"`,
    `args = ${tomlArray([shim, workspaceRoot, name])}`,
    `cwd = ${tomlString(workspaceRoot)}`,
    `startup_timeout_sec = 30`,
    `tool_timeout_sec = 120`,
  ];
  if (refs.length > 0) lines.push(`env_vars = ${tomlArray(refs)}`);
  return lines.join("\n");
}

function httpServerBlock(name: string, spec: McpSpec): { block: string; skipped?: undefined } | { block?: undefined; skipped: string } {
  if (!spec.url) return { skipped: "missing url" };
  const resolvedUrl = resolveNonSecretEnvRefs(spec.url);
  if (!resolvedUrl.ok) return { skipped: resolvedUrl.reason };

  const lines = [
    `[mcp_servers.${tomlKey(name)}]`,
    `url = ${tomlString(resolvedUrl.value)}`,
    `startup_timeout_sec = 30`,
    `tool_timeout_sec = 120`,
  ];

  const headers = spec.headers && typeof spec.headers === "object" ? spec.headers : {};
  const staticHeaders: Record<string, string> = {};
  const envHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const bearer = value.match(/^Bearer\s+\$\{([A-Z_][A-Z0-9_]*)\}$/);
    if (key.toLowerCase() === "authorization" && bearer) {
      lines.push(`bearer_token_env_var = ${tomlString(bearer[1])}`);
      continue;
    }
    const envOnly = value.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
    if (envOnly) {
      envHeaders[key] = envOnly[1];
      continue;
    }
    if (!SECRETISH.test(key) && !SECRETISH.test(value)) {
      staticHeaders[key] = value;
    }
  }

  const table = (values: Record<string, string>) =>
    `{ ${Object.entries(values).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`).join(", ")} }`;

  if (Object.keys(staticHeaders).length > 0) lines.push(`http_headers = ${table(staticHeaders)}`);
  if (Object.keys(envHeaders).length > 0) lines.push(`env_http_headers = ${table(envHeaders)}`);

  return { block: lines.join("\n") };
}

export function syncCodexMcpConfig(workspaceRoot: string, dashHome: string): { written: boolean; servers: string[]; skipped: string[]; path: string } {
  const mcpPath = path.join(workspaceRoot, ".mcp.json");
  const codexDir = path.join(os.homedir(), ".codex");
  const codexConfigPath = path.join(codexDir, "config.toml");
  const skipped: string[] = [];

  if (!fs.existsSync(mcpPath)) {
    return { written: false, servers: [], skipped: ["workspace .mcp.json missing"], path: codexConfigPath };
  }

  const parsed = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as McpConfig;
  const servers = parsed.mcpServers ?? {};
  const existing = fs.existsSync(codexConfigPath) ? fs.readFileSync(codexConfigPath, "utf8") : "";
  const stripped = stripManagedBlock(existing, workspaceRoot);
  const blocks: string[] = [];
  const names: string[] = [];

  for (const [name, spec] of Object.entries(servers)) {
    if (hasManualMcpServer(stripped, name)) {
      skipped.push(`${name}: already defined manually in Codex config`);
      continue;
    }
    if (spec.type === "http" || spec.url) {
      const result = httpServerBlock(name, spec);
      if (result.block) {
        blocks.push(result.block);
        names.push(name);
      } else {
        skipped.push(`${name}: ${result.skipped}`);
      }
      continue;
    }
    if (!spec.command) {
      skipped.push(`${name}: missing stdio command`);
      continue;
    }
    blocks.push(stdioServerBlock(name, workspaceRoot, dashHome, spec));
    names.push(name);
  }

  const markerStart = `# >>> ${MANAGED_LABEL}: ${workspaceRoot}`;
  const markerEnd = `# <<< ${MANAGED_LABEL}: ${workspaceRoot}`;
  const managed = [
    markerStart,
    "# Generated from workspace .mcp.json. Do not put secrets here.",
    "# Stdio servers go through scripts/codex-mcp-shim.js so env values resolve at runtime.",
    ...blocks,
    markerEnd,
    "",
  ].join("\n\n");

  fs.mkdirSync(codexDir, { recursive: true });
  const next = `${stripped.trimEnd()}\n\n${managed}`;
  if (next !== existing) {
    fs.writeFileSync(codexConfigPath, next, "utf8");
    return { written: true, servers: names, skipped, path: codexConfigPath };
  }
  return { written: false, servers: names, skipped, path: codexConfigPath };
}
