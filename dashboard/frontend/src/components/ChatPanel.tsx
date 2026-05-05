import { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDashboard, detectLanguage } from '../store';
import type { ChatMessage, Document } from '../types/dashboard';

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/x-sh'];
function isTextLikeMime(m: string) { return TEXT_MIME_PREFIXES.some(p => m.startsWith(p)); }

async function buildUploadedDoc(file: File, serverPath: string): Promise<Document> {
  const ext = detectLanguage(file.name);
  const isImage = file.type.startsWith('image/') || ext === 'image';
  const isText = !isImage && (isTextLikeMime(file.type) || ['text', 'markdown', 'json', 'yaml', 'toml', 'csv', 'svg', 'xml',
    'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'bash', 'sql', 'html', 'css', 'scss', 'dotenv'].includes(ext));

  let content = '';
  let language = ext;
  if (isImage) {
    content = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string); r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    language = 'image';
  } else if (isText) {
    content = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string); r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
    if (language === 'text' && file.name.endsWith('.log')) language = 'text';
  } else {
    language = 'binary';
  }
  return {
    id: `upload-${Date.now()}-${file.name}`,
    path: serverPath,
    filename: file.name,
    language,
    content,
    timestamp: Date.now(),
    size: file.size,
  };
}

function ToolCallCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const toolLine = lines[0]?.replace('Permission needed: ', '') || 'Tool Call';
  const inputLine = lines.slice(1).join('\n');

  return (
    <div className="chat-panel__tool-card">
      <button
        className="chat-panel__tool-card-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="chat-panel__tool-card-icon">{expanded ? 'v' : '>'}</span>
        <span className="chat-panel__tool-card-name">{toolLine}</span>
      </button>
      {expanded && inputLine && (
        <pre className="chat-panel__tool-card-body">{inputLine}</pre>
      )}
    </div>
  );
}

const MEMORY_ICON: Record<string, string> = {
  recall: '↺',
  remember: '✎',
  read: '⟵',
  write: '⟶',
  resume: '↻',
};

function MessageContent({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'memory') {
    const icon = MEMORY_ICON[msg.memoryAction || ''] || '·';
    return (
      <span className="chat-memory-pulse__content">
        <span className="chat-memory-pulse__icon">{icon}</span>
        <span className="chat-memory-pulse__action">{msg.memoryAction || 'memory'}</span>
        {msg.memoryRef && <span className="chat-memory-pulse__ref">{msg.memoryRef}</span>}
        <span className="chat-memory-pulse__text">{msg.content}</span>
      </span>
    );
  }

  if (msg.role === 'system') {
    if (msg.content.startsWith('Permission needed:')) {
      return <ToolCallCard content={msg.content} />;
    }
    return <span>{msg.content}</span>;
  }

  if (msg.role === 'user') {
    return <span>{msg.content}</span>;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !match && !className;
          if (isInline) {
            return <code className="chat-inline-code" {...props}>{children}</code>;
          }
          return (
            <div className="chat-code-block">
              {match && <div className="chat-code-block__lang">{match[1]}</div>}
              <pre><code className={className} {...props}>{children}</code></pre>
            </div>
          );
        },
        a({ href, children, ...props }) {
          return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
        },
        table({ children, ...props }) {
          return <div className="chat-table-wrap"><table {...props}>{children}</table></div>;
        },
      }}
    >
      {msg.content}
    </ReactMarkdown>
  );
}

function ElapsedTimer({ start }: { start: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(Math.floor((Date.now() - start) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [start]);

  if (elapsed < 1) return null;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return <span>{m > 0 ? `${m}m ${s}s` : `${s}s`}</span>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  idle:         { label: 'ready',        color: 'var(--color-text-muted)', dot: 'var(--color-text-muted)' },
  thinking:     { label: 'thinking',     color: 'var(--color-accent)',     dot: 'var(--color-accent)' },
  streaming:    { label: 'responding',   color: 'oklch(0.72 0.18 145)',    dot: 'oklch(0.72 0.18 145)' },
  done:         { label: 'done',         color: 'var(--color-text-muted)', dot: 'oklch(0.72 0.18 145)' },
  disconnected: { label: 'disconnected', color: 'oklch(0.68 0.22 25)',     dot: 'oklch(0.68 0.22 25)' },
};

interface ChatPanelProps {
  sessionId?: string;
  lineageLabel?: string;
  lineageColor?: string;
}

interface ModelInfoLite { id: string; label: string; note?: string }
interface AgentInfoLite {
  id: string;
  label: string;
  available: boolean;
  defaultModel: string;
  models: ModelInfoLite[];
}

let cachedAgents: AgentInfoLite[] | null = null;
let cachedAgentsAt = 0;
async function fetchAgentsCached(): Promise<AgentInfoLite[]> {
  const now = Date.now();
  if (cachedAgents && now - cachedAgentsAt < 30_000) return cachedAgents;
  try {
    const res = await fetch('/api/agents');
    const json = await res.json();
    if (Array.isArray(json.agents)) {
      cachedAgents = json.agents.map((a: AgentInfoLite) => ({
        id: a.id, label: a.label, available: a.available,
        defaultModel: a.defaultModel, models: a.models || [],
      }));
      cachedAgentsAt = now;
    }
  } catch { /* bridge warming up */ }
  return cachedAgents || [];
}

function useAgents(): AgentInfoLite[] {
  const [agents, setAgents] = useState<AgentInfoLite[]>(cachedAgents || []);
  useEffect(() => {
    let cancelled = false;
    fetchAgentsCached().then(a => { if (!cancelled) setAgents(a); });
    return () => { cancelled = true; };
  }, []);
  return agents;
}

function useDropdown<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return { open, setOpen, ref };
}

function ChatEnginePicker({ sessionId, currentAgentId }: { sessionId: string; currentAgentId: string | undefined }) {
  const { setSessionAgent } = useDashboard();
  const agents = useAgents();
  const { open, setOpen, ref } = useDropdown<HTMLDivElement>();

  const fallback = (typeof window !== 'undefined' && localStorage.getItem('venture-os-agent')) || 'claude';
  const active = agents.find(a => a.id === (currentAgentId || fallback));
  const label = active?.label || (currentAgentId || fallback);

  function pick(id: string) {
    const agent = agents.find(a => a.id === id);
    if (!agent || !agent.available) return;
    setOpen(false);
    setSessionAgent(sessionId, id);
  }

  return (
    <div ref={ref} className="chat-panel__engine-picker">
      <button
        className="chat-panel__engine-btn"
        onClick={() => setOpen(!open)}
        title={`Engine for this chat: ${label}`}
      >
        <span className="chat-panel__engine-dot" />
        <span>{label}</span>
        <span className="chat-panel__engine-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="chat-panel__engine-menu">
          {agents.length === 0 && <div className="chat-panel__engine-empty">loading…</div>}
          {agents.map(a => (
            <button
              key={a.id}
              className={`chat-panel__engine-item ${a.id === active?.id ? 'chat-panel__engine-item--active' : ''} ${!a.available ? 'chat-panel__engine-item--disabled' : ''}`}
              onClick={() => pick(a.id)}
              aria-disabled={!a.available}
            >
              <span className="chat-panel__engine-item-dot" style={{ background: a.available ? 'var(--color-accent)' : 'oklch(0.65 0.2 25)' }} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatModelPicker({ sessionId, currentAgentId, currentModelId }: { sessionId: string; currentAgentId: string | undefined; currentModelId: string | undefined }) {
  const { setSessionModel } = useDashboard();
  const agents = useAgents();
  const { open, setOpen, ref } = useDropdown<HTMLDivElement>();

  const fallbackAgent = (typeof window !== 'undefined' && localStorage.getItem('venture-os-agent')) || 'claude';
  const agent = agents.find(a => a.id === (currentAgentId || fallbackAgent));
  if (!agent || agent.models.length === 0) return null;

  const fallbackModel = (typeof window !== 'undefined' && localStorage.getItem(`venture-os-model-${agent.id}`)) || agent.defaultModel;
  const activeModelId = currentModelId || fallbackModel;
  const activeModel = agent.models.find(m => m.id === activeModelId);
  const label = activeModel?.label || activeModelId;

  function pick(id: string) {
    setOpen(false);
    setSessionModel(sessionId, id);
  }

  return (
    <div ref={ref} className="chat-panel__engine-picker">
      <button
        className="chat-panel__engine-btn"
        onClick={() => setOpen(!open)}
        title={`Model for this chat: ${label}`}
      >
        <span>{label}</span>
        <span className="chat-panel__engine-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="chat-panel__engine-menu">
          {agent.models.map(m => (
            <button
              key={m.id}
              className={`chat-panel__engine-item ${m.id === activeModelId ? 'chat-panel__engine-item--active' : ''}`}
              onClick={() => pick(m.id)}
            >
              <span className="chat-panel__engine-item-dot" style={{ background: 'var(--color-accent)' }} />
              <span>{m.label}</span>
              {m.note && <span style={{ marginLeft: 'auto', opacity: 0.55, fontSize: 9 }}>{m.note}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ sessionId = 'session-0', lineageLabel, lineageColor }: ChatPanelProps) {
  const dashboard = useDashboard();
  const { sendChatMessage, stopResponse, editMessage, forkChat, getSessionChat, memoryIndex, newChat, restartSession } = dashboard;

  // Read from this session's own chat state
  const sessionChat = getSessionChat(sessionId);
  const messages = sessionChat.messages;
  const chatThinking = sessionChat.thinking;
  const chatStatus = sessionChat.status;
  const chatThinkingStart = sessionChat.thinkingStart;

  const [input, setInput] = useState('');
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  interface PendingAttachment { name: string; size: number; type: string; path?: string; uploading: boolean; error?: string; file: File }
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  async function uploadFile(file: File): Promise<{ path?: string; error?: string }> {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const resp = await fetch('/api/chat/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, type: file.type, data }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) return { error: json.error || `HTTP ${resp.status}` };
      return { path: json.path };
    } catch (err) { return { error: String(err) }; }
  }

  function acceptFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    // Reject anything over 25MB (server allows 30MB base64 ≈ ~22MB binary)
    const valid = list.filter(f => {
      if (f.size > 25 * 1024 * 1024) { alert(`${f.name} is over 25MB and won't be attached.`); return false; }
      return true;
    });
    const pending: PendingAttachment[] = valid.map(f => ({
      name: f.name, size: f.size, type: f.type, uploading: true, file: f,
    }));
    setAttachments(a => [...a, ...pending]);
    for (const p of pending) {
      uploadFile(p.file).then(async r => {
        setAttachments(a => a.map(x => x.file === p.file ? { ...x, uploading: false, path: r.path, error: r.error } : x));
        if (r.path && !r.error) {
          try {
            const doc = await buildUploadedDoc(p.file, r.path);
            dashboard.addUploadedDocument(doc);
          } catch (e) { console.warn('[uploaded-docs] failed to build preview:', e); }
        }
      });
    }
  }

  function removeAttachment(i: number) {
    setAttachments(a => a.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ready = attachments.filter(a => a.path);
    const hasText = input.trim().length > 0;
    if (!hasText && ready.length === 0) return;
    // If uploads are still in flight, wait
    if (attachments.some(a => a.uploading)) return;

    let prompt = input.trim();
    if (ready.length > 0) {
      const list = ready.map(a => `  - ${a.path} (${a.name}, ${a.type || 'file'})`).join('\n');
      prompt = `[User attached ${ready.length} file${ready.length === 1 ? '' : 's'} — use the Read tool to open them]\n${list}\n\n${prompt || '(Please review the attached files.)'}`;
    }
    sendChatMessage(prompt, sessionId);
    setInput('');
    setAttachments([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) {
          // Clipboard images land as "image.png" — give them a friendlier, unique name.
          const name = f.name && f.name !== 'image.png'
            ? f.name
            : `pasted-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('+xml', '')}`;
          files.push(new File([f], name, { type: f.type }));
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      acceptFiles(files);
    }
    // Plain-text paste falls through to default behavior.
  }

  function handleEditMessage(msgId: string) {
    const content = editMessage(msgId, sessionId);
    if (content !== null) {
      setInput(content);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  const cfg = STATUS_CONFIG[chatStatus] || STATUS_CONFIG.idle;
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnTime, setLearnTime] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const isBusy = chatStatus === 'thinking' || chatStatus === 'streaming';
  const memoryCount = memoryIndex?.entries.length || 0;
  const memoryTypes = memoryIndex ? Array.from(new Set(memoryIndex.entries.map(e => e.type))) : [];

  // Memory health — dot color + tooltip in the chat header. Polls every 60s
  // and on each new chat message so silent rot becomes visible (the April 28
  // bug where nothing wrote for 5 days).
  interface MemoryHealth {
    sidecar: { state: string; restarts: number; lastError: string | null } | null;
    supabase: {
      configured: boolean;
      reachable: boolean;
      totalMemories: number | null;
      lastWriteAt: string | null;
      daysSinceLastWrite: number | null;
      voyageConfigured: boolean;
      error: string | null;
    } | null;
  }
  const [health, setHealth] = useState<MemoryHealth | null>(null);
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/memory/health');
        if (!r.ok) return;
        const data = (await r.json()) as MemoryHealth;
        if (!cancelled) setHealth(data);
      } catch { /* bridge offline */ }
    }
    load();
    const id = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [messages.length]);

  function healthSeverity(h: MemoryHealth | null): 'ok' | 'warn' | 'down' | 'unknown' {
    if (!h) return 'unknown';
    if (!h.supabase?.configured || !h.supabase?.reachable) return 'down';
    const days = h.supabase.daysSinceLastWrite;
    if (days === null) return 'warn';
    if (days >= 2) return 'warn';
    return 'ok';
  }
  const sev = healthSeverity(health);
  const sevColor = sev === 'ok' ? 'oklch(0.72 0.18 145)' : sev === 'warn' ? 'oklch(0.78 0.14 95)' : sev === 'down' ? 'oklch(0.65 0.22 25)' : 'var(--color-text-muted)';
  const sevLabel = (() => {
    if (!health) return 'memory: …';
    if (sev === 'down') return `memory: down${health.supabase?.error ? ` (${health.supabase.error})` : ''}`;
    const d = health.supabase?.daysSinceLastWrite;
    if (d === null || d === undefined) return 'memory: never written';
    if (d === 0) return 'memory: today';
    return `memory: ${d}d stale`;
  })();
  const sevTooltip = health
    ? `Sidecar: ${health.sidecar?.state ?? 'unknown'} (restarts: ${health.sidecar?.restarts ?? 0})\n` +
      `Supabase: ${health.supabase?.reachable ? 'reachable' : 'unreachable'}\n` +
      `Total memories (this workspace): ${health.supabase?.totalMemories ?? '?'}\n` +
      `Last write: ${health.supabase?.lastWriteAt ?? '(never)'}\n` +
      `Voyage embeddings: ${health.supabase?.voyageConfigured ? 'on' : 'off'}\n` +
      `Click to capture now`
    : 'memory health: loading…';

  async function captureNow() {
    if (capturing) return;
    setCapturing(true);
    try {
      const log = messages.slice(-30).map(m => `${m.role}: ${m.content}`);
      const r = await fetch('/api/memory/capture-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, conversationLog: log }),
      });
      const data = await r.json().catch(() => ({})) as { ok?: boolean; id?: string; error?: string };
      if (data.ok) {
        // Refresh health immediately to flip the badge to green.
        const hr = await fetch('/api/memory/health');
        if (hr.ok) setHealth(await hr.json());
      } else {
        alert(`Capture failed: ${data.error ?? `HTTP ${r.status}`}`);
      }
    } catch (e) {
      alert(`Capture failed: ${String(e)}`);
    } finally {
      setCapturing(false);
    }
  }

  function startLearn() {
    const t = learnTime.trim();
    if (!t || isBusy) return;
    setLearnOpen(false);
    setLearnTime('');
    sendChatMessage(
      `Run /evolve until ${t}. Use all available session time. When a session runs out, write a handoff to .planning/evolve/handoff.md with remaining time and what was done. ` +
      `When the next session starts, read the handoff and continue from where you left off. ` +
      `Consolidate memory, assess gaps, discover and install tools. Keep cycling until ${t}.`,
      sessionId,
    );
  }

  return (
    <div
      className={`chat-panel ${dropActive ? 'chat-panel--drop-active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDropActive(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropActive(false); }}
      onDrop={e => {
        e.preventDefault(); setDropActive(false);
        if (e.dataTransfer.files?.length) acceptFiles(e.dataTransfer.files);
      }}
    >
      {dropActive && (
        <div className="chat-panel__drop-overlay">
          <div className="chat-panel__drop-text">Drop files to attach</div>
        </div>
      )}
      {/* Header */}
      <div className="chat-panel__header">
        <span>
          {sessionChat.rootLabel && (
            <span className="chat-panel__root-tag" style={{ background: lineageColor || 'var(--color-accent)' }}>
              {sessionChat.rootLabel}
            </span>
          )}
          {lineageLabel && (
            <span className="chat-panel__lineage" style={{ color: lineageColor }}>{lineageLabel}</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <ChatEnginePicker sessionId={sessionId} currentAgentId={sessionChat.agentId} />
          <ChatModelPicker sessionId={sessionId} currentAgentId={sessionChat.agentId} currentModelId={sessionChat.modelId} />
          <button
            className="chat-panel__fork-btn"
            onClick={() => newChat()}
            title="Start a new chat from zero"
            style={{ padding: '2px 6px' }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
            <span>New</span>
          </button>
          <button
            className={`chat-panel__fork-btn ${isBusy ? 'chat-panel__fork-btn--disabled' : ''}`}
            onClick={() => !isBusy && forkChat(sessionId, `Fork ${Date.now().toString(36).slice(-4)}`)}
            title="Fork conversation into new window"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M6 9v6c0 1.657 1.343 3 3 3h3" />
              <line x1="18" y1="9" x2="18" y2="15" />
            </svg>
            <span>Fork</span>
          </button>
          <button
            className={`chat-panel__learn-btn ${isBusy ? 'chat-panel__learn-btn--disabled' : ''}`}
            onClick={() => !isBusy && setLearnOpen(v => !v)}
            title="Start learning mode"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span>Learn</span>
          </button>
          <button
            className={`chat-panel__fork-btn ${isBusy ? 'chat-panel__fork-btn--disabled' : ''}`}
            onClick={() => {
              if (isBusy) return;
              setInput('');
              setAttachments([]);
              restartSession(sessionId);
            }}
            title="Restart this chat — clears conversation, keeps the window and global memory"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
            <span>Restart</span>
          </button>
          {learnOpen && (
            <div className="chat-panel__learn-menu">
              <input
                className="chat-panel__learn-input"
                value={learnTime}
                onChange={e => setLearnTime(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startLearn()}
                placeholder="e.g. 7am, 2 hours, 30m"
                autoFocus
              />
              <button
                className="chat-panel__learn-option"
                onClick={startLearn}
                disabled={!learnTime.trim()}
              >
                Go
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Memory banner — shows what auto-memory is active */}
      {memoryIndex && (
        <div className={`chat-panel__memory-bar ${memoryOpen ? 'chat-panel__memory-bar--open' : ''}`}>
          <button
            className="chat-panel__memory-bar-header"
            onClick={() => setMemoryOpen(v => !v)}
            title="Auto-memory loaded into this session"
          >
            <span className="chat-panel__memory-bar-caret">{memoryOpen ? 'v' : '>'}</span>
            <span className="chat-panel__memory-bar-icon">🧠</span>
            <span className="chat-panel__memory-bar-label">
              {memoryCount === 0
                ? 'No memories yet — the active engine will write as it learns'
                : `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'} active`}
            </span>
            {memoryTypes.length > 0 && (
              <span className="chat-panel__memory-bar-types">
                {memoryTypes.slice(0, 4).join(' · ')}
              </span>
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); if (!capturing) captureNow(); }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !capturing) { e.preventDefault(); captureNow(); } }}
              title={sevTooltip}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid color-mix(in oklch, ${sevColor} 50%, transparent)`,
                background: `color-mix(in oklch, ${sevColor} 12%, transparent)`,
                color: sevColor,
                fontSize: 9,
                fontFamily: 'var(--font-family-mono)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                cursor: capturing ? 'progress' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: capturing ? 0.6 : 1,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: sevColor }} />
              {capturing ? 'capturing…' : sevLabel}
            </span>
          </button>
          {memoryOpen && memoryIndex.entries.length > 0 && (
            <div className="chat-panel__memory-bar-list">
              {memoryIndex.entries.slice(0, 30).map(e => (
                <div key={e.file} className="chat-panel__memory-bar-item">
                  <span className={`chat-panel__memory-bar-type chat-panel__memory-bar-type--${e.type}`}>
                    {e.type}
                  </span>
                  <span className="chat-panel__memory-bar-name" title={e.description}>
                    {e.name}
                  </span>
                  {e.description && (
                    <span className="chat-panel__memory-bar-desc">{e.description}</span>
                  )}
                </div>
              ))}
              {memoryIndex.entries.length > 30 && (
                <div className="chat-panel__memory-bar-more">
                  +{memoryIndex.entries.length - 30} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="chat-panel__messages">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`chat-panel__msg chat-panel__msg--${msg.role}`}
            onMouseEnter={() => msg.role === 'user' && setHoveredMsgId(msg.id)}
            onMouseLeave={() => setHoveredMsgId(null)}
          >
            <MessageContent msg={msg} />
            {msg.role === 'user' && hoveredMsgId === msg.id && (
              <button
                className="chat-panel__edit-btn"
                onClick={(e) => { e.stopPropagation(); handleEditMessage(msg.id); }}
                title="Edit and resend"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            )}
          </div>
        ))}

        {/* Thinking / streaming indicator — 3 animated dots + elapsed seconds.
            Stays visible while status is thinking OR streaming so the user
            always sees the agent is alive (not just during the first blank
            pause before the first token arrives). */}
        {(chatThinking || chatStatus === 'streaming' || chatStatus === 'thinking') && (
          <div className="chat-panel__thinking-dots">
            <span className="chat-panel__dot" />
            <span className="chat-panel__dot" />
            <span className="chat-panel__dot" />
            {chatThinkingStart && (
              <span className="chat-panel__thinking-elapsed">
                <ElapsedTimer start={chatThinkingStart} />
              </span>
            )}
          </div>
        )}
        {chatStatus === 'disconnected' && (
          <div className="chat-panel__thinking-dots chat-panel__thinking-dots--alert">
            ⚠ bridge disconnected mid-turn — auto-reconnecting and will resume the prompt.
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Status bar + Input */}
      <div className="chat-panel__input-area">
        <div className="chat-panel__status-bar">
          <span
            className={`chat-panel__status-dot ${chatStatus === 'thinking' || chatStatus === 'streaming' ? 'chat-panel__status-dot--pulse' : ''} ${chatStatus === 'disconnected' ? 'chat-panel__status-dot--alert' : ''}`}
            style={{ background: cfg.dot }}
          />
          <span className="chat-panel__status-label" style={{ color: cfg.color }}>
            {cfg.label}
            {(chatStatus === 'thinking' || chatStatus === 'streaming') && chatThinkingStart && (
              <> — <ElapsedTimer start={chatThinkingStart} /></>
            )}
            {chatStatus === 'disconnected' && (
              <> · bridge dropped, will resume on reconnect</>
            )}
          </span>
          {(chatStatus === 'thinking' || chatStatus === 'streaming') && (
            <button
              type="button"
              className="chat-panel__stop-btn"
              onClick={() => stopResponse(sessionId)}
              title="Stop response"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <span>Stop</span>
            </button>
          )}
        </div>
        {attachments.length > 0 && (
          <div className="chat-panel__attachments">
            {attachments.map((a, i) => (
              <div key={i} className={`chat-panel__chip ${a.error ? 'chat-panel__chip--error' : ''} ${a.uploading ? 'chat-panel__chip--uploading' : ''}`}>
                <span className="chat-panel__chip-icon">{a.type.startsWith('image/') ? '🖼' : a.type.includes('pdf') ? '📄' : '📎'}</span>
                <span className="chat-panel__chip-name" title={a.name}>{a.name}</span>
                <span className="chat-panel__chip-size">{(a.size / 1024).toFixed(0)}kB</span>
                {a.uploading && <span className="chat-panel__chip-status">uploading…</span>}
                {a.error && <span className="chat-panel__chip-status" title={a.error}>error</span>}
                <button type="button" className="chat-panel__chip-x" onClick={() => removeAttachment(i)} title="Remove">×</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="chat-panel__form">
          <div className="chat-panel__input-wrap">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.length) acceptFiles(e.target.files); e.target.value = ''; }}
            />
            <button
              type="button"
              className="chat-panel__attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files (images, PDFs, docs)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              className="chat-panel__input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask anything, paste images, or drop files…"
              rows={1}
              style={{ overflowY: input ? 'auto' : 'hidden' }}
            />
            <button
              type="submit"
              className={`chat-panel__send-btn ${(input.trim() || attachments.some(a => a.path)) ? 'chat-panel__send-btn--active' : ''}`}
              disabled={(!input.trim() && !attachments.some(a => a.path)) || attachments.some(a => a.uploading)}
              title={attachments.some(a => a.uploading) ? 'Waiting for uploads…' : 'Send message'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
