import { useMemo, useState } from 'react';
import { useDashboard } from '../store';
import type { ChatMessage, ConversationRecord, Document, SessionChatState } from '../types/dashboard';

// Topic inference: strip the conversational wrapper around the first user
// message ("can you", "i want to", "how do i", etc.) and surface the actual
// subject. Concatenates the first 3 user messages so titles still work when
// the user warms up before stating the real ask. No LLM call — purely
// regex-driven so it runs in the archive flow without latency or auth deps.
const TITLE_STRIPS: RegExp[] = [
  /^(?:hey|hi|hello)[,.\s]+/i,
  /^(?:so|now|ok|okay|alright)[,.\s]+/i,
  /^(?:please|kindly)[,.\s]+/i,
  /^(?:can|could|would|will|should)\s+you\s+(?:please\s+)?/i,
  /^(?:i'?d?\s+(?:like|want|need)\s+(?:to|you\s+to)?\s+)/i,
  /^(?:i'?m\s+(?:trying\s+to|going\s+to|looking\s+to)\s+)/i,
  /^(?:i\s+(?:want|need|would\s+like|wanted)\s+(?:to\s+)?)/i,
  /^(?:let'?s\s+)/i,
  /^(?:help\s+me\s+(?:to\s+)?)/i,
  /^(?:how\s+(?:do|to|can|should)\s+(?:i\s+|we\s+|you\s+)?)/i,
  /^(?:what'?s?\s+(?:the\s+(?:best|right)\s+(?:way\s+)?)?(?:to|for)\s+)/i,
  /^(?:show\s+me\s+(?:how\s+to\s+)?)/i,
  /^(?:tell\s+me\s+(?:about\s+)?)/i,
  /^(?:explain\s+(?:to\s+me\s+)?(?:what\s+|how\s+)?)/i,
  /^(?:make\s+sure\s+(?:that\s+|to\s+)?)/i,
];

function inferTitle(messages: ChatMessage[], fallback = 'Untitled chat'): string {
  const userMsgs = messages.filter(m => m.role === 'user' && m.content.trim());
  if (userMsgs.length === 0) {
    const any = messages.find(m => m.content.trim());
    if (!any) return fallback;
    const t = any.content.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  }
  let raw = userMsgs.slice(0, 3).map(m => m.content).join(' ');
  raw = raw.replace(/\[User attached[\s\S]*?\]\n?/g, '').replace(/\s+/g, ' ').trim();
  // Strip wrappers iteratively — some messages stack openings ("hey, can you please...")
  let title = raw;
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of TITLE_STRIPS) {
      const next = title.replace(re, '');
      if (next !== title) { title = next; changed = true; break; }
    }
  }
  title = title.replace(/[?!.]+$/g, '').trim();
  const firstSentence = title.split(/(?:[.!?]\s+)/)[0] || title;
  const TARGET = 60;
  let result = firstSentence;
  if (result.length > TARGET) {
    const trunc = result.slice(0, TARGET);
    const lastSpace = trunc.lastIndexOf(' ');
    result = (lastSpace > 30 ? trunc.slice(0, lastSpace) : trunc) + '…';
  }
  if (result.length > 0) result = result.charAt(0).toUpperCase() + result.slice(1);
  return result || fallback;
}

function preview(messages: ChatMessage[]): string {
  const text = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-4)
    .map(m => `${m.role}: ${m.content}`)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function activeRecord(sessionId: string, session: SessionChatState): ConversationRecord | null {
  if (!session.messages.some(m => m.role === 'user' || m.role === 'assistant')) return null;
  const firstTs = session.messages[0]?.timestamp || Date.now();
  const lastTs = session.messages[session.messages.length - 1]?.timestamp || firstTs;
  return {
    id: sessionId,
    sessionId,
    title: inferTitle(session.messages, session.rootLabel ? `Chat ${session.rootLabel}` : 'Untitled chat'),
    rootLabel: session.rootLabel,
    createdAt: firstTs,
    updatedAt: lastTs,
    reason: 'active',
    messages: session.messages,
    preview: preview(session.messages),
  };
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

function matchScore(record: ConversationRecord, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const title = record.title.toLowerCase();
  const body = `${record.preview} ${record.messages.map(m => m.content).join(' ')}`.toLowerCase();
  let score = 0;
  if (title.includes(q)) score += 40;
  if (record.preview.toLowerCase().includes(q)) score += 20;
  if (body.includes(q)) score += 10;
  for (const part of q.split(/\s+/).filter(Boolean)) {
    if (title.includes(part)) score += 5;
    if (body.includes(part)) score += 2;
  }
  return score;
}

function safeFileName(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chat';
}

function attachmentLine(doc: Document): string {
  return `- ${doc.filename || doc.path || doc.id}${doc.url ? ` (${doc.url})` : ''}`;
}

function exportConversation(record: ConversationRecord) {
  const lines = [
    `# ${record.title}`,
    '',
    `Session: ${record.sessionId}`,
    `Created: ${new Date(record.createdAt).toISOString()}`,
    `Updated: ${new Date(record.updatedAt).toISOString()}`,
    record.endedAt ? `Ended: ${new Date(record.endedAt).toISOString()}` : 'Status: active',
    `Reason: ${record.reason}`,
    '',
    '## Messages',
    '',
    ...record.messages.flatMap((m) => [
      `### ${m.role} - ${new Date(m.timestamp).toISOString()}`,
      '',
      m.content || '',
      ...(m.attachments?.length ? ['', 'Attachments:', ...m.attachments.map(attachmentLine)] : []),
      '',
    ]),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileName(record.title)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ChatHistoryPanel() {
  const { conversationHistory, chatSessions } = useDashboard();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const records = useMemo(() => {
    const map = new Map<string, ConversationRecord>();
    for (const record of conversationHistory) map.set(record.id, record);
    for (const [sid, session] of Object.entries(chatSessions)) {
      const record = activeRecord(sid, session);
      if (record) map.set(record.id, record);
    }
    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [chatSessions, conversationHistory]);

  const filtered = useMemo(() => {
    const scored = records
      .map(record => ({ record, score: matchScore(record, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt);
    return scored.map(item => item.record);
  }, [query, records]);

  const selected = filtered.find(r => r.id === selectedId) || filtered[0] || null;

  return (
    <div className="chat-history">
      <div className="chat-history__sidebar">
        <div className="chat-history__search-row">
          <input
            className="chat-history__search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats"
          />
          <span className="chat-history__count">{filtered.length}</span>
        </div>
        <div className="chat-history__list">
          {filtered.map(record => (
            <button
              key={record.id}
              className={`chat-history__item ${selected?.id === record.id ? 'chat-history__item--active' : ''}`}
              onClick={() => setSelectedId(record.id)}
            >
              <span className="chat-history__item-title">{record.title}</span>
              <span className="chat-history__item-meta">
                {record.rootLabel ? `Chat ${record.rootLabel} | ` : ''}{record.reason === 'active' ? 'active' : record.reason} | {formatTime(record.updatedAt)}
              </span>
              <span className="chat-history__item-preview">{record.preview || 'No assistant/user messages yet.'}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="chat-history__empty">No matching conversations.</div>
          )}
        </div>
      </div>

      <div className="chat-history__detail">
        {selected ? (
          <>
            <div className="chat-history__detail-head">
              <div>
                <h3>{selected.title}</h3>
                <p>
                  {formatTime(selected.createdAt)} - {selected.endedAt ? formatTime(selected.endedAt) : 'active'}
                </p>
              </div>
              <button className="chat-history__export" onClick={() => exportConversation(selected)}>
                Export
              </button>
            </div>
            <div className="chat-history__messages">
              {selected.messages.map(message => (
                <article key={message.id} className={`chat-history__message chat-history__message--${message.role}`}>
                  <div className="chat-history__message-meta">
                    <span>{message.role}</span>
                    <span>{formatTime(message.timestamp)}</span>
                  </div>
                  <div className="chat-history__message-body">{message.content}</div>
                  {message.attachments?.length ? (
                    <div className="chat-history__attachments">
                      {message.attachments.map(doc => (
                        <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer">
                          {doc.language === 'image' ? 'image' : 'file'}: {doc.filename}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="chat-history__empty chat-history__empty--center">No conversations stored yet.</div>
        )}
      </div>
    </div>
  );
}
