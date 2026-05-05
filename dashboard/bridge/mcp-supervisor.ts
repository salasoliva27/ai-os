import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export interface McpSidecar {
  name: string;
  script: string;
  port: number;
  host?: string;
  env?: Record<string, string | undefined>;
}

export interface McpSidecarStatus {
  name: string;
  pid: number | null;
  port: number;
  host: string;
  url: string;
  restarts: number;
  lastExitCode: number | null;
  lastExitSignal: NodeJS.Signals | null;
  lastError: string | null;
  startedAt: string | null;
  state: "starting" | "running" | "crashed" | "stopped";
}

interface Running {
  def: McpSidecar;
  child: ChildProcess | null;
  status: McpSidecarStatus;
  restartTimer: NodeJS.Timeout | null;
  backoffMs: number;
  stopping: boolean;
}

const DEFAULT_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export class McpSupervisor {
  private sidecars = new Map<string, Running>();

  spawn(def: McpSidecar): void {
    if (this.sidecars.has(def.name)) return;
    const host = def.host ?? "127.0.0.1";
    const running: Running = {
      def: { ...def, host },
      child: null,
      status: {
        name: def.name,
        pid: null,
        port: def.port,
        host,
        url: `http://${host}:${def.port}/mcp`,
        restarts: 0,
        lastExitCode: null,
        lastExitSignal: null,
        lastError: null,
        startedAt: null,
        state: "starting",
      },
      restartTimer: null,
      backoffMs: DEFAULT_BACKOFF_MS,
      stopping: false,
    };
    this.sidecars.set(def.name, running);
    this.start(running);
  }

  private start(running: Running): void {
    const { def } = running;
    const env = {
      ...process.env,
      MCP_TRANSPORT: "http",
      MCP_HTTP_PORT: String(def.port),
      MCP_HTTP_HOST: def.host ?? "127.0.0.1",
      ...(def.env ?? {}),
    };
    const child = spawn("node", [def.script], {
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    running.child = child;
    running.status.pid = child.pid ?? null;
    running.status.startedAt = new Date().toISOString();
    running.status.state = "running";

    child.once("exit", (code, signal) => {
      running.status.lastExitCode = code;
      running.status.lastExitSignal = signal;
      running.status.pid = null;
      running.child = null;
      if (running.stopping) {
        running.status.state = "stopped";
        return;
      }
      running.status.state = "crashed";
      running.status.restarts += 1;
      const delay = running.backoffMs;
      running.backoffMs = Math.min(running.backoffMs * 2, MAX_BACKOFF_MS);
      console.error(
        `[mcp-supervisor] ${def.name} exited code=${code} signal=${signal} — restarting in ${delay}ms`,
      );
      running.restartTimer = setTimeout(() => {
        running.restartTimer = null;
        running.status.state = "starting";
        this.start(running);
      }, delay);
      running.restartTimer.unref();
    });

    child.once("error", err => {
      running.status.lastError = err.message;
      console.error(`[mcp-supervisor] ${def.name} error:`, err.message);
    });

    // After a stable 10s run, reset backoff so flaps don't permanently stretch restarts.
    setTimeout(() => {
      if (running.child === child && running.status.state === "running") {
        running.backoffMs = DEFAULT_BACKOFF_MS;
      }
    }, 10000).unref();
  }

  status(): McpSidecarStatus[] {
    return Array.from(this.sidecars.values()).map(r => ({ ...r.status }));
  }

  async shutdown(): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const running of this.sidecars.values()) {
      running.stopping = true;
      if (running.restartTimer) {
        clearTimeout(running.restartTimer);
        running.restartTimer = null;
      }
      const child = running.child;
      if (!child || child.exitCode !== null) {
        running.status.state = "stopped";
        continue;
      }
      waits.push(
        new Promise<void>(resolve => {
          const done = () => resolve();
          child.once("exit", done);
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
          }, 3000).unref();
        }),
      );
    }
    await Promise.all(waits);
  }
}

export function defaultSidecars(workspaceRoot: string): McpSidecar[] {
  return [
    {
      name: "janus-memory",
      script: path.join(workspaceRoot, "mcp-servers", "memory", "index.js"),
      port: Number(process.env.MCP_MEMORY_PORT ?? 3211),
    },
  ];
}
