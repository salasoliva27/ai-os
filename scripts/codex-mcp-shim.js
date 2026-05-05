#!/usr/bin/env node
/*
 * Codex MCP shim.
 *
 * Codex reads MCP servers from ~/.codex/config.toml, while the Janus brain
 * treats workspace .mcp.json as canonical. This shim lets Codex reuse .mcp.json
 * without copying secrets into Codex config: config.toml starts this script,
 * and the script resolves ${ENV_VAR} values at runtime before spawning the
 * real stdio MCP server.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const [, , workspaceRootArg, serverName] = process.argv;

if (!workspaceRootArg || !serverName) {
  console.error("Usage: codex-mcp-shim.js <workspace-root> <server-name>");
  process.exit(2);
}

const workspaceRoot = path.resolve(workspaceRootArg);
const configPath = path.join(workspaceRoot, ".mcp.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error(`Failed to read ${configPath}: ${err.message}`);
    process.exit(2);
  }
}

function resolveEnvValue(value, missing) {
  if (typeof value !== "string") return "";
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name) => {
    const resolved = process.env[name];
    if (!resolved) missing.add(name);
    return resolved || "";
  });
}

const config = readConfig();
const spec = config?.mcpServers?.[serverName];

if (!spec || typeof spec !== "object") {
  console.error(`MCP server "${serverName}" not found in ${configPath}`);
  process.exit(2);
}

if (spec.type === "http" || spec.url) {
  console.error(`MCP server "${serverName}" is HTTP-based; configure it directly in Codex config.`);
  process.exit(2);
}

if (typeof spec.command !== "string" || spec.command.length === 0) {
  console.error(`MCP server "${serverName}" has no command.`);
  process.exit(2);
}

const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
const missing = new Set();
const childEnv = { ...process.env };
const envSpec = spec.env && typeof spec.env === "object" && !Array.isArray(spec.env) ? spec.env : {};

for (const [key, value] of Object.entries(envSpec)) {
  childEnv[key] = resolveEnvValue(value, missing);
}

if (missing.size > 0) {
  console.error(`Missing environment variables for MCP server "${serverName}": ${Array.from(missing).join(", ")}`);
  process.exit(2);
}

const child = spawn(spec.command, args, {
  cwd: workspaceRoot,
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("error", err => {
  console.error(`Failed to start MCP server "${serverName}": ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
