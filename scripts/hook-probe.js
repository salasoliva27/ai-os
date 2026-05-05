#!/usr/bin/env node
// DIAG (temporary): unconditional hook-firing probe.
// Captures argv, cwd, env vars, and stdin to .janus/hook-probe.log
// so we can tell whether the Claude Code harness on Windows invokes hooks
// at all, and what env it provides.

const fs = require('fs');
const path = require('path');
const os = require('os');

const probeDir = path.join(__dirname, '..', '.janus');
try { fs.mkdirSync(probeDir, { recursive: true }); } catch {}
const logPath = path.join(probeDir, 'hook-probe.log');

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => stdin += c);
process.stdin.on('end', () => {
  const record = {
    ts: new Date().toISOString(),
    argv: process.argv,
    cwd: process.cwd(),
    pid: process.pid,
    ppid: process.ppid,
    platform: os.platform(),
    shell: process.env.SHELL || null,
    comspec: process.env.ComSpec || null,
    claude_project_dir: process.env.CLAUDE_PROJECT_DIR || null,
    workspace_root: process.env.WORKSPACE_ROOT || null,
    path_first_3: (process.env.PATH || process.env.Path || '').split(path.delimiter).slice(0, 3),
    stdin_len: stdin.length,
    stdin_first_200: stdin.slice(0, 200),
  };
  try {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (e) {
    // last-resort: write to home dir
    try { fs.appendFileSync(path.join(os.homedir(), 'janus-hook-probe-fallback.log'), JSON.stringify({err: e.message, record}) + '\n'); } catch {}
  }
});

// If stdin is closed already (no input), still flush
setTimeout(() => process.stdin.emit('end'), 50);
