import type { WebSocket } from "ws";
import { ClaudeSession } from "./claude-session.js";
import { PermissionManager } from "./permissions.js";
import type { ServerMessage } from "./types.js";

const MAX_CONCURRENT = 4;

interface SessionEntry {
  session: ClaudeSession;
  parentId: string | null;
  label: string;
  depth: number;
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();
  // Multiple tabs can connect simultaneously; each gets a live mirror of
  // every session's output. Without multiplexing, opening a second tab
  // silently black-holes messages meant for the first.
  private clients = new Set<WebSocket>();
  // Messages emitted while NO clients are attached get queued and flushed on
  // the next attach. Bounded so a long disconnect doesn't blow memory.
  private queue: (ServerMessage & { sessionId?: string })[] = [];
  private readonly QUEUE_LIMIT = 500;

  constructor(ws?: WebSocket) {
    if (ws) this.clients.add(ws);
  }

  /** Add a WebSocket to the broadcast set; flush any pending messages to it. */
  attachWs(ws: WebSocket): void {
    this.clients.add(ws);
    // Keep the engine session's legacy ws ref pointing at a live one for paths
    // that still read it directly (e.g. read-only status sends).
    for (const entry of this.sessions.values()) entry.session.setWs(ws);
    // Flush queued messages so this tab sees what it missed while disconnected.
    while (this.queue.length > 0 && ws.readyState === 1) {
      const msg = this.queue.shift()!;
      try { ws.send(JSON.stringify(msg)); } catch { break; }
    }
  }

  /** Remove one WebSocket from the broadcast set — sessions keep running. */
  detachWs(ws?: WebSocket): void {
    if (ws) this.clients.delete(ws);
    else this.clients.clear();
    // If a client is still attached, point sessions at it so direct ws
    // references (in legacy code paths) still send successfully.
    const still = [...this.clients].find(c => c.readyState === 1);
    for (const entry of this.sessions.values()) entry.session.setWs(still ?? null);
  }

  /** Emit to every attached client. If none are attached, queue it. */
  broadcast(msg: ServerMessage & { sessionId?: string }): void {
    const payload = JSON.stringify(msg);
    let delivered = 0;
    for (const ws of this.clients) {
      if (ws.readyState === 1) {
        try { ws.send(payload); delivered++; } catch { /* swallow; stale ws */ }
      }
    }
    if (delivered === 0) {
      this.queue.push(msg);
      if (this.queue.length > this.QUEUE_LIMIT) this.queue.shift();
    }
  }

  createSession(sessionId: string, agentId: string = "claude"): ClaudeSession {
    if (this.sessions.size >= MAX_CONCURRENT) {
      this.send({ type: "error", message: `Max ${MAX_CONCURRENT} concurrent sessions reached`, sessionId });
      // Return a dummy — caller should check
      const existing = this.sessions.values().next().value;
      if (existing) return existing.session;
    }

    const pm = new PermissionManager();
    const firstLive = [...this.clients].find(c => c.readyState === 1) ?? null;
    const session = new ClaudeSession(firstLive, pm, sessionId, agentId, this);
    this.sessions.set(sessionId, {
      session,
      parentId: null,
      label: "Main",
      depth: 0,
    });
    return session;
  }

  forkSession(
    parentId: string,
    newId: string,
    forkLabel: string,
    forkMessageIndex: number,
  ): ClaudeSession | null {
    const parent = this.sessions.get(parentId);
    if (!parent) {
      this.send({ type: "error", message: `Parent session ${parentId} not found`, sessionId: newId });
      return null;
    }

    if (this.sessions.size >= MAX_CONCURRENT) {
      this.send({ type: "error", message: `Max ${MAX_CONCURRENT} concurrent sessions reached`, sessionId: newId });
      return null;
    }

    const pm = new PermissionManager();
    const firstLive = [...this.clients].find(c => c.readyState === 1) ?? null;
    const session = new ClaudeSession(firstLive, pm, newId, parent.session.getAgent(), this);

    // Inject parent conversation history as context
    const history = parent.session.getConversationLog();
    const truncated = history.slice(0, forkMessageIndex);
    if (truncated.length > 0) {
      session.setForkContext(truncated);
    }

    const depth = parent.depth + 1;
    this.sessions.set(newId, {
      session,
      parentId,
      label: forkLabel,
      depth,
    });

    return session;
  }

  getSession(id: string): ClaudeSession | undefined {
    return this.sessions.get(id)?.session;
  }

  getLineage(id: string): { parentId: string | null; label: string; depth: number } | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    return { parentId: entry.parentId, label: entry.label, depth: entry.depth };
  }

  getSiblings(sessionId: string): string[] {
    const entry = this.sessions.get(sessionId);
    if (!entry) return [];
    // Siblings = other sessions with same parent, or parent/children
    const result: string[] = [];
    for (const [id, e] of this.sessions) {
      if (id === sessionId) continue;
      if (e.parentId === entry.parentId || e.parentId === sessionId || entry.parentId === id) {
        result.push(id);
      }
    }
    return result;
  }

  closeSession(id: string): void {
    const entry = this.sessions.get(id);
    if (entry) {
      entry.session.close();
      this.sessions.delete(id);
    }
  }

  closeAll(): void {
    for (const [id, entry] of this.sessions) {
      entry.session.close();
    }
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }

  private send(msg: ServerMessage & { sessionId?: string }): void {
    this.broadcast(msg);
  }
}
