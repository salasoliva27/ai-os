import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../store';
import type { JiraTicket } from '../types/dashboard';
import './TicketsPanel.css';

const STATUS_COLORS: Record<string, string> = {
  new: 'oklch(0.68 0.22 25)',           // red
  indeterminate: 'oklch(0.78 0.14 95)', // amber
  done: 'oklch(0.72 0.18 145)',         // green
  '': 'oklch(0.65 0.02 240)',           // muted
};

const PRIORITY_COLORS: Record<string, string> = {
  Highest: 'oklch(0.68 0.22 25)',
  High: 'oklch(0.72 0.20 35)',
  Medium: 'oklch(0.78 0.14 95)',
  Low: 'oklch(0.65 0.02 240)',
  Lowest: 'oklch(0.55 0.02 240)',
};

function relativeTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

interface TicketDetail extends JiraTicket {
  description: string;
  comments: Array<{ author: string; createdAt: string; body: string }>;
}

function useTicketDetail(key: string | null, refreshTick: number) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!key) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/jira/tickets/${encodeURIComponent(key)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: TicketDetail) => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setErr(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, refreshTick]);

  return { detail, loading, err };
}

interface Transition { id: string; name: string; toStatus: string }

function useTransitions(key: string | null, refreshTick: number) {
  const [transitions, setTransitions] = useState<Transition[]>([]);
  useEffect(() => {
    if (!key) { setTransitions([]); return; }
    let cancelled = false;
    fetch(`/api/jira/tickets/${encodeURIComponent(key)}/transitions`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { transitions?: Transition[] }) => { if (!cancelled) setTransitions(d.transitions ?? []); })
      .catch(() => { if (!cancelled) setTransitions([]); });
    return () => { cancelled = true; };
  }, [key, refreshTick]);
  return transitions;
}

export function TicketsPanel() {
  const { jiraTickets, sendChatMessage } = useDashboard();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const projectOptions = useMemo(() => Array.from(new Set((jiraTickets ?? []).map(t => t.projectKey))).sort(), [jiraTickets]);
  const statusOptions = useMemo(() => Array.from(new Set((jiraTickets ?? []).map(t => t.status))).sort(), [jiraTickets]);

  const filtered = useMemo(() => {
    return (jiraTickets ?? []).filter(t => {
      if (projectFilter && t.projectKey !== projectFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      return true;
    });
  }, [jiraTickets, projectFilter, statusFilter]);

  const [detailRefresh, setDetailRefresh] = useState(0);
  const { detail, loading: detailLoading, err: detailErr } = useTicketDetail(selectedKey, detailRefresh);
  const transitions = useTransitions(selectedKey, detailRefresh);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  async function applyTransition(tid: string, name: string) {
    if (!selectedKey || actionBusy) return;
    setActionBusy(`transition-${tid}`);
    setActionMsg(null);
    try {
      const r = await fetch(`/api/jira/tickets/${encodeURIComponent(selectedKey)}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transitionId: tid }),
      });
      if (r.ok) {
        setActionMsg(`moved to "${name}"`);
        setDetailRefresh(n => n + 1);
        fetch('/api/jira/refresh', { method: 'POST' }).catch(() => {});
      } else {
        const err = await r.json().catch(() => ({}));
        setActionMsg(`failed: ${err.error || `HTTP ${r.status}`}`);
      }
    } catch (e) {
      setActionMsg(`failed: ${String(e)}`);
    } finally {
      setActionBusy(null);
    }
  }

  async function postComment() {
    if (!selectedKey || !commentDraft.trim() || actionBusy) return;
    setActionBusy('comment');
    setActionMsg(null);
    try {
      const r = await fetch(`/api/jira/tickets/${encodeURIComponent(selectedKey)}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentDraft.trim() }),
      });
      if (r.ok) {
        setActionMsg('comment posted');
        setCommentDraft('');
        setDetailRefresh(n => n + 1);
      } else {
        const err = await r.json().catch(() => ({}));
        setActionMsg(`failed: ${err.error || `HTTP ${r.status}`}`);
      }
    } catch (e) {
      setActionMsg(`failed: ${String(e)}`);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch('/api/jira/refresh', { method: 'POST' });
    } catch { /* swallow — store will receive the broadcast either way */ }
    finally { setRefreshing(false); }
  }

  function dropIntoChat(t: JiraTicket | TicketDetail) {
    const desc = 'description' in t ? `\n\n${t.description}` : '';
    const prompt = `New Jira ticket — find any related context in tickets/ before answering, then propose a plan.\n\n[${t.key}] ${t.summary}\nProject: ${t.projectName} (${t.projectKey})\nStatus: ${t.status}${t.priority ? ` · Priority: ${t.priority}` : ''}\nLink: ${t.url}${desc}`;
    sendChatMessage(prompt);
  }

  return (
    <div className="tickets-panel">
      <div className="tickets-panel__toolbar">
        <span className="tickets-panel__count">{filtered.length} {filtered.length === 1 ? 'ticket' : 'tickets'}</span>
        <select className="tickets-panel__filter" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
          <option value="">all projects</option>
          {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="tickets-panel__filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">all statuses</option>
          {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="tickets-panel__refresh" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? '…' : 'Refresh'}
        </button>
      </div>

      {jiraTickets.length === 0 ? (
        <div className="tickets-panel__empty">
          No tickets loaded yet. The bridge polls every 2 min — if this stays
          empty after a launch, check <code>/api/jira/state</code> for the
          configuration / error reason.
        </div>
      ) : (
        <div className="tickets-panel__body">
          <ul className="tickets-panel__list">
            {filtered.map(t => {
              const statusColor = STATUS_COLORS[t.statusCategory] ?? STATUS_COLORS[''];
              const priColor = t.priority ? (PRIORITY_COLORS[t.priority] ?? 'var(--color-text-muted)') : 'var(--color-text-muted)';
              return (
                <li key={t.key}>
                  <button
                    type="button"
                    className={`tickets-panel__row ${selectedKey === t.key ? 'tickets-panel__row--selected' : ''}`}
                    onClick={() => setSelectedKey(t.key)}
                  >
                    <span className="tickets-panel__key">{t.key}</span>
                    <span className="tickets-panel__summary">{t.summary}</span>
                    <span className="tickets-panel__status" style={{ background: `color-mix(in oklch, ${statusColor} 18%, transparent)`, color: statusColor, borderColor: `color-mix(in oklch, ${statusColor} 40%, transparent)` }}>
                      {t.status}
                    </span>
                    {t.priority && (
                      <span className="tickets-panel__priority" style={{ color: priColor }}>{t.priority}</span>
                    )}
                    <span className="tickets-panel__age">{relativeTime(t.updated)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selectedKey && (
            <aside className="tickets-panel__drawer">
              <div className="tickets-panel__drawer-header">
                <span className="tickets-panel__drawer-key">{selectedKey}</span>
                <button className="tickets-panel__drawer-close" onClick={() => setSelectedKey(null)} aria-label="Close">×</button>
              </div>
              {detailLoading && <div className="tickets-panel__drawer-loading">loading…</div>}
              {detailErr && <div className="tickets-panel__drawer-err">error: {detailErr}</div>}
              {detail && (
                <>
                  <div className="tickets-panel__drawer-summary">{detail.summary}</div>
                  <div className="tickets-panel__drawer-meta">
                    <span>{detail.projectName} ({detail.projectKey})</span>
                    <span>·</span>
                    <span>{detail.issueType}</span>
                    <span>·</span>
                    <span>{detail.status}</span>
                    {detail.priority && (<><span>·</span><span>{detail.priority}</span></>)}
                  </div>
                  <div className="tickets-panel__drawer-actions">
                    <a className="tickets-panel__drawer-btn" href={detail.url} target="_blank" rel="noopener noreferrer">Open in Jira</a>
                    <button className="tickets-panel__drawer-btn tickets-panel__drawer-btn--primary" onClick={() => dropIntoChat(detail)}>
                      Drop into chat
                    </button>
                  </div>

                  {transitions.length > 0 && (
                    <div className="tickets-panel__drawer-section">
                      <div className="tickets-panel__drawer-section-title">Move to</div>
                      <div className="tickets-panel__transitions">
                        {transitions.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            className="tickets-panel__transition-btn"
                            disabled={!!actionBusy}
                            onClick={() => applyTransition(t.id, t.toStatus)}
                            title={`Transition: ${t.name} → ${t.toStatus}`}
                          >
                            {actionBusy === `transition-${t.id}` ? '…' : t.toStatus}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="tickets-panel__drawer-section">
                    <div className="tickets-panel__drawer-section-title">Add comment</div>
                    <textarea
                      className="tickets-panel__comment-input"
                      placeholder="Update the ticket in plain text…"
                      value={commentDraft}
                      onChange={e => setCommentDraft(e.target.value)}
                      rows={3}
                    />
                    <div className="tickets-panel__comment-actions">
                      <button
                        type="button"
                        className="tickets-panel__drawer-btn tickets-panel__drawer-btn--primary"
                        onClick={postComment}
                        disabled={!commentDraft.trim() || actionBusy === 'comment'}
                      >
                        {actionBusy === 'comment' ? 'posting…' : 'Post comment'}
                      </button>
                    </div>
                  </div>

                  {actionMsg && (
                    <div className="tickets-panel__action-msg">{actionMsg}</div>
                  )}
                  {detail.description && (
                    <div className="tickets-panel__drawer-section">
                      <div className="tickets-panel__drawer-section-title">Description</div>
                      <pre className="tickets-panel__drawer-body">{detail.description}</pre>
                    </div>
                  )}
                  {detail.comments.length > 0 && (
                    <div className="tickets-panel__drawer-section">
                      <div className="tickets-panel__drawer-section-title">Comments ({detail.comments.length})</div>
                      <ul className="tickets-panel__drawer-comments">
                        {detail.comments.map((c, i) => (
                          <li key={i} className="tickets-panel__drawer-comment">
                            <div className="tickets-panel__drawer-comment-meta">
                              <span>{c.author}</span>
                              <span>·</span>
                              <span>{relativeTime(c.createdAt)}</span>
                            </div>
                            <pre className="tickets-panel__drawer-body">{c.body}</pre>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
