// Venture OS Dashboard — All Types

export interface Project {
  id: string;
  name: string;
  displayName: string;
  stage: 'idea' | 'dev' | 'uat' | 'prod';
  stack: string[];
  health: 'green' | 'amber' | 'red';
  currentPhase: string;
  phaseProgress: number;
  lastCommit: { message: string; hash: string; age: string };
  description: string;
  burn?: number;
  revenue?: number;
  legalFlags: string[];
  nextActions: string[];
  color: string;
  repo?: string;
  memoryCount?: number;
  // Discovery metadata — which GitHub identity surfaced this repo.
  // `account` is the short label from GITHUB_TOKEN_SOURCES (e.g. 'personal',
  // 'reece'). `owner` is the GitHub login. Both are absent for legacy /
  // non-discovered projects.
  account?: string;
  owner?: string;
  // STATUS.md-derived (only present once a repo has been bootstrapped):
  summary?: string;
  hasStatusFile?: boolean;
  statusValue?: string;       // active | paused | done | archived
  nextSteps?: Array<{ id: string; title: string; priority: string; effortHours: number; done: boolean }>;
  milestones?: Array<{ date: string; description: string }>;
}

export interface ScheduledEvent {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  start: string;
  end: string;
  priority: string;
  color: string;
  notes?: string;
}

export interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  priority: string | null;
  assigneeName: string | null;
  reporterName: string | null;
  projectKey: string;
  projectName: string;
  issueType: string;
  updated: string;
  created: string;
  duedate: string | null;
  url: string;
  labels: string[];
}

export interface TalendJob {
  id: string;
  name: string;
  workspace: string;
  workspaceId: string;
  environment: string;
  environmentId: string;
  description: string;
  scheduleEnabled: boolean;
  scheduleSummary: string | null;
  lastExecutionId: string | null;
  lastStatus: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  artifactName: string | null;
  artifactType: string | null;
  versions: string[];
  latestVersion: string | null;
}

export interface AgentDispatch {
  id: string;
  agent: string;
  icon: string;
  project: string;
  tools: string[];
  status: 'thinking' | 'executing' | 'verifying' | 'done';
  phase: 'IDENTIFY' | 'DISPATCH' | 'LOOKUP' | 'EXECUTE' | 'VERIFY' | 'OUTPUT';
  timestamp: number;
  message: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  icon: string;
  role: string;
  description: string;
  file: string;
  lastUpdated: string; // ISO date
  tools: string[];
  linkedAgents: string[];
}

export interface ToolStatus {
  id: string;
  name: string;
  shortName: string;
  callCount: number;
  lastCall: number;
  active: boolean;
  configured: 'ready' | 'needs-key' | 'needs-auth' | 'unknown';
  envVar?: string; // e.g. BRAVE_API_KEY
  authUrl?: string; // e.g. OAuth flow URL
  consoleType?: 'sql'; // tools with a console open a workbench on click (e.g. supabase, snowflake)
}

export interface MemoryEntry {
  id: string;
  type: 'decision' | 'learning' | 'context' | 'recall';
  direction: 'in' | 'out';
  content: string;
  project?: string;
  timestamp: number;
}

export interface GitCommit {
  id: string;
  repo: string;
  repoColor: string;
  message: string;
  timestamp: number;
  hash: string;
}

export interface BrainNode {
  id: string;
  label: string;
  group: 'wiki' | 'concepts' | 'learnings' | 'agents' | 'other';
  connections: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

export interface BrainEdge {
  source: string;
  target: string;
  firing: boolean;
  fireProgress: number;
}

export interface Notification {
  id: string;
  type: 'drift' | 'conflict' | 'legal' | 'capacity' | 'memory';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  project?: string;
}

export interface SessionEvent {
  id: string;
  type: 'edit' | 'commit' | 'dispatch' | 'memory' | 'tool' | 'push';
  label: string;
  detail?: string;
  timestamp: number;
  project?: string;
}

export interface Learning {
  id: string;
  /** The behavioral rule — how the agent's thinking changed */
  rule: string;
  /** The raw insight/fact that produced this learning */
  content: string;
  domain: 'market' | 'technical' | 'legal' | 'gtm' | 'pattern';
  project: string;
  timestamp: number;
  /** IDs of memory entries that contributed to this learning */
  sourceMemoryIds: string[];
  /** Whether this learning has been argued/debated by the user */
  status: 'active' | 'argued' | 'revised' | 'rejected';
}

export interface CalendarSlot {
  date: string;
  dayLabel: string;
  load: number;
  items: string[];
}

export interface FileActivity {
  path: string;
  repo: string;
  repoColor: string;
  size: number;
  lastModified: number;
  changes: number;
}

export type CenterView = 'constellation' | 'brain' | 'procedures' | 'files';

export type BrainSource = 'vault' | 'usage';

export interface Document {
  id: string;
  path: string;
  filename: string;
  language: string;
  content: string;
  timestamp: number;
  /** Bytes — only meaningful for uploaded binary docs */
  size?: number;
  /** Drive view URL once the async Drive mirror completes */
  driveUrl?: string;
}

export interface DashboardState {
  // Data
  projects: Project[];
  agents: AgentDispatch[];
  tools: ToolStatus[];
  memories: MemoryEntry[];
  gitCommits: GitCommit[];
  brainNodes: BrainNode[];
  brainEdges: BrainEdge[];
  brainSource: BrainSource;
  notifications: Notification[];
  sessionEvents: SessionEvent[];
  learnings: Learning[];
  terminalLines: string[];
  calendarSlots: CalendarSlot[];
  /** Calendar events scheduled by Janus from each project's STATUS.md.
   *  When non-empty, supersedes the hardcoded calendar fixtures. */
  scheduledEvents: ScheduledEvent[];
  /** Talend tasks pulled from Qlik Talend Cloud — populated by `talend_jobs_set`. */
  talendJobs: TalendJob[];
  /** Jira tickets pulled from Atlassian Cloud — populated by `tickets_set`
   *  WebSocket message. Empty until the first poll completes. */
  jiraTickets: JiraTicket[];
  fileActivities: FileActivity[];
  documents: Document[];
  uploadedDocuments: Document[];
  // UI state
  selectedProject: string | null;
  selectedBrainNode: string | null;
  centerView: CenterView;
  commandPaletteOpen: boolean;
  scoreboardOpen: boolean;
  /** Per-session chat — keyed by sessionId */
  chatSessions: Record<string, SessionChatState>;
  chatInput: string;
  chatAuth: string | null;
  // Legacy compat — derived from chatSessions['session-0']
  chatMessages: ChatMessage[];
  chatThinking: boolean;
  chatStatus: 'idle' | 'thinking' | 'streaming' | 'done' | 'disconnected';
  chatThinkingStart: number | null;
  activeDocumentId: string | null;
  rightPanelTab: 'memory' | 'documents' | 'uploaded' | 'editor';
  agentCounts: Record<string, number>;
  projectCounts: Record<string, number>;
  /** Auto-memory index loaded from /api/memory/index */
  memoryIndex: MemoryIndex | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'memory';
  content: string;
  timestamp: number;
  /** For memory messages: which memory file / operation this refers to */
  memoryRef?: string;
  /** For memory messages: direction of the operation */
  memoryAction?: 'recall' | 'remember' | 'read' | 'write' | 'resume';
}

export interface MemoryIndexEntry {
  file: string;
  name: string;
  description: string;
  type: string;
  updatedAt: number;
  preview: string;
}

export interface MemoryIndex {
  entries: MemoryIndexEntry[];
  indexContent: string;
  dir: string;
  fetchedAt: number;
}

/** Per-session chat state — each fork gets its own message list + status */
export interface SessionChatState {
  messages: ChatMessage[];
  thinking: boolean;
  status: 'idle' | 'thinking' | 'streaming' | 'done' | 'disconnected';
  thinkingStart: number | null;
  lastActivityAt: number | null;
  /** Approximate input-token count of the in-flight turn (based on prompt length). */
  inflightTokens: number | null;
  /** Sibling summaries — what other forks are doing */
  siblingUpdates: { sessionId: string; summary: string; timestamp: number }[];
  /** Per-session engine binding. Falls back to the global default when absent. */
  agentId?: string;
  /** Per-session model binding (within the chosen agent). Falls back to the agent's default. */
  modelId?: string;
  /** The top-level chat this session descends from — own id for roots, parent's root for forks. */
  rootSessionId?: string;
  /** Human-friendly label for top-level chats ("Chat A", "Chat B"…). Forks reuse parent's root label. */
  rootLabel?: string;
}

export interface DashboardActions {
  selectProject: (id: string | null) => void;
  selectBrainNode: (id: string | null) => void;
  setCenterView: (view: CenterView) => void;
  setBrainSource: (source: BrainSource) => void;
  toggleCommandPalette: () => void;
  toggleScoreboard: () => void;
  sendChatMessage: (msg: string, sessionId?: string) => void;
  stopResponse: (sessionId?: string) => void;
  editMessage: (messageId: string, sessionId?: string) => string | null;
  getSessionChat: (sessionId: string) => SessionChatState;
  dismissNotification: (id: string) => void;
  addTerminalLine: (line: string) => void;
  setActiveDocument: (id: string | null) => void;
  setRightPanelTab: (tab: 'memory' | 'documents' | 'uploaded' | 'editor') => void;
  addUploadedDocument: (doc: Document) => void;
  forkChat: (parentSessionId: string, label: string) => string;
  /** Switch the engine bound to a specific chat session (mid-conversation). */
  setSessionAgent: (sessionId: string, agentId: string, modelId?: string) => void;
  /** Switch the model within the current agent for one chat session. */
  setSessionModel: (sessionId: string, modelId: string) => void;
  /** Create a brand-new top-level chat (no parent). Returns the new sessionId. */
  newChat: (opts?: { agentId?: string; modelId?: string; label?: string }) => string;
  /** Wipe this chat's visible conversation + engine context, but keep the
   *  window, label, agent/model bindings, and all global memory intact. The
   *  same sessionId is reused — the next user message starts a fresh engine
   *  session under that id. */
  restartSession: (sessionId: string) => void;
}

// White-label configuration
export interface DashboardConfig {
  instanceName: string;
  owner: string;
  bridgeUrl: string;
  features: Record<string, boolean>;
  projectIds: string[];
}
