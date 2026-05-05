// Mirror of bridge/types.ts — kept in sync manually
// These types define the WebSocket protocol between frontend and bridge

export type ClientMessage =
  | { type: "start"; prompt: string; cwd?: string; sessionId?: string; agentId?: string; modelId?: string }
  | { type: "follow_up"; prompt: string; sessionId?: string; agentId?: string; modelId?: string }
  | { type: "permission_response"; id: string; allowed: boolean; sessionId?: string }
  | { type: "interrupt"; sessionId?: string }
  | { type: "fork"; parentSessionId: string; newSessionId: string; forkLabel: string; forkMessageIndex: number }
  | { type: "set_agent"; sessionId?: string; agentId: string; modelId?: string }
  | { type: "set_model"; sessionId?: string; modelId: string }
  | { type: "restart_session"; sessionId: string };

export type ServerMessage =
  | { type: "claude_message"; message: unknown; sessionId?: string }
  | { type: "permission_request"; id: string; toolName: string; input: Record<string, unknown>; sessionId?: string }
  | { type: "tool_event"; toolName: string; input: unknown; sessionId: string; timestamp: number }
  | { type: "fs_event"; event: string; path: string; timestamp: number }
  | { type: "learning_update"; learning: { id: string; rule: string; content: string; domain: string; project: string; timestamp: number; sourceMemoryIds: string[]; status: string } }
  | { type: "project_update"; projectId: string; updates: { projectId: string; lastCommit?: { hash: string; message: string; age: string }; memoryCount?: number; currentPhase?: string; nextActions?: string[]; summary?: string; phaseProgress?: number; status?: string; nextSteps?: Array<{ id: string; title: string; priority: string; effortHours: number; done: boolean }>; milestones?: Array<{ date: string; description: string }>; hasStatusFile?: boolean } }
  | { type: "calendar_set"; events: Array<{ id: string; projectId: string; projectName: string; title: string; start: string; end: string; priority: string; color: string; notes?: string }> }
  | { type: "tickets_set"; tickets: Array<{ key: string; summary: string; status: string; statusCategory: string; priority: string | null; assigneeName: string | null; reporterName: string | null; projectKey: string; projectName: string; issueType: string; updated: string; created: string; duedate: string | null; url: string; labels: string[] }> }
  | { type: "talend_jobs_set"; jobs: Array<{ id: string; name: string; workspace: string; workspaceId: string; environment: string; environmentId: string; description: string; scheduleEnabled: boolean; scheduleSummary: string | null; lastExecutionId: string | null; lastStatus: string | null; lastStartedAt: string | null; lastFinishedAt: string | null; artifactName: string | null; artifactType: string | null; versions: string[]; latestVersion: string | null }> }
  | { type: "projects_set"; projects: Array<{ id: string; name: string; displayName: string; stage: 'idea' | 'dev' | 'uat' | 'prod'; stack: string[]; health: 'green' | 'amber' | 'red'; currentPhase: string; phaseProgress: number; lastCommit: { message: string; hash: string; age: string }; description: string; legalFlags: string[]; nextActions: string[]; color: string; repo: string; account: string; owner: string }> }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "session_end"; cost?: number; usage?: unknown; sessionId?: string }
  | { type: "session_start"; auth: string; sessionId?: string }
  | { type: "sibling_summary"; sessionId: string; siblingId: string; summary: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
