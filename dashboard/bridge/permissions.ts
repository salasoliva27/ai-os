import type { WebSocket } from "ws";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ServerMessage } from "./types.js";

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const TIMEOUT = 60_000;

export class PermissionManager {
  private pending = new Map<string, PendingPermission>();

  request(
    ws: WebSocket,
    toolName: string,
    input: Record<string, unknown>,
    toolUseID: string,
  ): Promise<PermissionResult> {
    // T-01-04: If ID already pending, ignore duplicate
    if (this.pending.has(toolUseID)) {
      return Promise.resolve({ behavior: "deny" as const, message: "Duplicate permission request" });
    }

    const msg: ServerMessage = {
      type: "permission_request",
      id: toolUseID,
      toolName,
      input,
    };
    ws.send(JSON.stringify(msg));

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(toolUseID);
        resolve({ behavior: "deny" as const, message: "Permission timed out (60s)" });
      }, TIMEOUT);

      this.pending.set(toolUseID, { resolve, timer });
    });
  }

  resolve(id: string, allowed: boolean): void {
    const entry = this.pending.get(id);
    if (!entry) return; // T-01-04: ignore unknown IDs
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(
      allowed
        ? { behavior: "allow" as const }
        : { behavior: "deny" as const, message: "User denied" },
    );
  }

  rejectAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ behavior: "deny" as const, message: "WebSocket disconnected" });
    }
    this.pending.clear();
  }
}
