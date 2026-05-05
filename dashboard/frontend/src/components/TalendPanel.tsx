import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../store';
import type { TalendJob } from '../types/dashboard';
import './TalendPanel.css';

const STATUS_COLORS: Record<string, string> = {
  EXECUTION_SUCCESSFUL: 'oklch(0.72 0.18 145)',
  EXECUTION_FAILED:     'oklch(0.68 0.22 25)',
  EXECUTION_RUNNING:    'oklch(0.74 0.16 200)',
  EXECUTION_PENDING:    'oklch(0.78 0.14 95)',
  EXECUTION_CANCELLED:  'oklch(0.65 0.05 250)',
};

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s - m * 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m - h * 60;
  return `${h}h ${rm}m`;
}

function shortStatus(s: string | null): string {
  if (!s) return '—';
  return s.replace(/^EXECUTION_/, '').toLowerCase();
}

interface ExecutionRecord {
  executionId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

interface ScheduleSummary {
  id: string;
  description: string;
  executableId: string;
  executableType: string;
  environmentId: string;
  trigger: {
    type: string;
    expression?: string;
    timeZone?: string;
    atTimes?: string[];
    interval?: number;
    startDate?: string;
    name?: string;
  } | null;
}

function useAllSchedules(refreshTick: number) {
  const [list, setList] = useState<ScheduleSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/talend/schedules')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { schedules?: ScheduleSummary[] }) => { if (!cancelled) setList(d.schedules ?? []); })
      .catch(() => { if (!cancelled) setList([]); });
    return () => { cancelled = true; };
  }, [refreshTick]);
  return list;
}

function summarizeTrigger(t: ScheduleSummary['trigger']): string {
  if (!t) return '(no trigger)';
  if (t.type === 'CRON' && t.expression) return `cron ${t.expression}${t.timeZone ? ` ${t.timeZone}` : ''}`;
  const tz = t.timeZone ? ` ${t.timeZone}` : '';
  const at = t.atTimes?.length ? ` at ${t.atTimes.join(', ')}` : '';
  return `${t.type.toLowerCase()}${at}${tz}`;
}

interface ScheduleEditorProps {
  initial?: ScheduleSummary;
  executableId: string;
  environmentId: string;
  onClose: () => void;
  onSaved: () => void;
}

function ScheduleEditor({ initial, executableId, environmentId, onClose, onSaved }: ScheduleEditorProps) {
  const [type, setType] = useState<'DAILY' | 'WEEKLY' | 'CRON'>((initial?.trigger?.type as 'DAILY' | 'WEEKLY' | 'CRON') ?? 'DAILY');
  const [time, setTime] = useState(initial?.trigger?.atTimes?.[0] ?? '06:00');
  const [cron, setCron] = useState(initial?.trigger?.expression ?? '0 6 * * *');
  const [timeZone, setTimeZone] = useState(initial?.trigger?.timeZone ?? 'America/Chicago');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const trigger: Record<string, unknown> = { type, timeZone };
    if (type === 'CRON') trigger.expression = cron;
    else trigger.atTimes = [time];
    const body = { executableId, environmentId, description, trigger };
    const url = initial ? `/api/talend/schedules/${encodeURIComponent(initial.id)}` : '/api/talend/schedules';
    const method = initial ? 'PUT' : 'POST';
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (data.ok || r.ok) { onSaved(); onClose(); return; }
      setErr(data.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="talend-panel__sched-editor">
      <div className="talend-panel__sched-editor-row">
        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value as 'DAILY' | 'WEEKLY' | 'CRON')}>
          <option value="DAILY">daily at time</option>
          <option value="WEEKLY">weekly at time</option>
          <option value="CRON">cron expression</option>
        </select>
      </div>
      {type !== 'CRON' ? (
        <div className="talend-panel__sched-editor-row">
          <label>Time</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      ) : (
        <div className="talend-panel__sched-editor-row">
          <label>Cron</label>
          <input type="text" value={cron} onChange={e => setCron(e.target.value)} placeholder="0 6 * * *" />
        </div>
      )}
      <div className="talend-panel__sched-editor-row">
        <label>Timezone</label>
        <input type="text" value={timeZone} onChange={e => setTimeZone(e.target.value)} placeholder="America/Chicago" />
      </div>
      <div className="talend-panel__sched-editor-row">
        <label>Description</label>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="optional" />
      </div>
      {err && <div className="talend-panel__sched-editor-err">{err}</div>}
      <div className="talend-panel__sched-editor-actions">
        <button type="button" className="talend-panel__drawer-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="talend-panel__drawer-btn talend-panel__drawer-btn--primary" onClick={save} disabled={busy}>
          {busy ? 'saving…' : (initial ? 'Save changes' : 'Create schedule')}
        </button>
      </div>
    </div>
  );
}

export function TalendPanel() {
  const { talendJobs } = useDashboard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ schedule?: ScheduleSummary; executableId: string; environmentId: string } | null>(null);

  const allSchedules = useAllSchedules(scheduleRefresh);

  const jobs = talendJobs ?? [];
  const envOptions = useMemo(() => Array.from(new Set(jobs.map(j => j.environment).filter(Boolean))).sort(), [jobs]);
  const typeOptions = useMemo(() => Array.from(new Set(jobs.map(j => j.artifactType).filter(Boolean) as string[])).sort(), [jobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter(j => {
      if (envFilter && j.environment !== envFilter) return false;
      if (statusFilter === 'scheduled' && !j.scheduleEnabled) return false;
      if (statusFilter === 'unscheduled' && j.scheduleEnabled) return false;
      if (statusFilter && statusFilter !== 'scheduled' && statusFilter !== 'unscheduled' && j.artifactType !== statusFilter) return false;
      if (q) {
        const hay = `${j.name} ${j.workspace} ${j.environment} ${j.artifactName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, envFilter, statusFilter, query]);

  const selected = selectedId ? jobs.find(j => j.id === selectedId) ?? null : null;

  // Heuristic match: schedules whose environment matches the selected
  // artifact AND whose description contains the artifact name. Same logic
  // the backend uses for the scheduleEnabled flag.
  const matchedSchedules = useMemo(() => {
    if (!selected) return [];
    const name = selected.name.toLowerCase();
    return allSchedules.filter(s => s.environmentId === selected.environmentId && (s.description ?? '').toLowerCase().includes(name));
  }, [selected, allSchedules]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { await fetch('/api/talend/refresh', { method: 'POST' }); }
    catch { /* swallow */ }
    finally { setRefreshing(false); }
  }

  async function deleteSchedule(s: ScheduleSummary) {
    if (!confirm(`Delete schedule "${s.description || s.id}"?\n\nThis cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/talend/schedules/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (data.ok || r.ok) {
        setActionMsg(`deleted schedule ${s.id}`);
        setScheduleRefresh(n => n + 1);
      } else {
        setActionMsg(`failed: ${data.error ?? `HTTP ${r.status}`}`);
      }
    } catch (e) {
      setActionMsg(`failed: ${String(e)}`);
    }
  }

  return (
    <div className="talend-panel">
      <div className="talend-panel__toolbar">
        <span className="talend-panel__count">{filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}</span>
        <input
          className="talend-panel__search"
          placeholder="search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select className="talend-panel__filter" value={envFilter} onChange={e => setEnvFilter(e.target.value)}>
          <option value="">all envs</option>
          {envOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className="talend-panel__filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">all</option>
          <option value="scheduled">scheduled</option>
          <option value="unscheduled">unscheduled</option>
          {typeOptions.map(o => <option key={o} value={o}>type: {o}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="talend-panel__refresh" onClick={refresh} disabled={refreshing}>
          {refreshing ? '…' : 'Refresh'}
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="talend-panel__empty">
          No Talend artifacts loaded yet. The bridge polls every 5 min — if this
          stays empty, check <code>/api/talend/state</code> for the region + error.
          <br /><br />
          <strong>Note</strong>: the panel currently shows artifacts (published code)
          + schedule heuristics. The runnable Tasks endpoint isn't reachable with
          your current PAT — re-mint with the <em>View Tasks and Plans</em> +
          <em>Execute Tasks and Plans</em> roles to unlock run-now and execution
          history.
        </div>
      ) : (
        <div className="talend-panel__body">
          <ul className="talend-panel__list">
            {filtered.map(j => {
              const typeColor = j.artifactType === 'plan' ? 'oklch(0.72 0.18 200)' : 'var(--color-text-muted)';
              return (
                <li key={j.id}>
                  <button
                    type="button"
                    className={`talend-panel__row ${selectedId === j.id ? 'talend-panel__row--selected' : ''}`}
                    onClick={() => setSelectedId(j.id)}
                  >
                    <span className="talend-panel__name">{j.name}</span>
                    <span className="talend-panel__env">{j.environment || '—'}</span>
                    <span className="talend-panel__ws">{j.workspace}</span>
                    <span className="talend-panel__status" style={{ background: `color-mix(in oklch, ${typeColor} 18%, transparent)`, color: typeColor, borderColor: `color-mix(in oklch, ${typeColor} 40%, transparent)` }}>
                      {j.artifactType ?? '—'}
                    </span>
                    <span className="talend-panel__sched" title={j.scheduleSummary ?? 'no schedule matched (heuristic)'}>
                      {j.scheduleEnabled ? '⏱' : ''}
                    </span>
                    <span className="talend-panel__age" title={j.latestVersion ? `latest v${j.latestVersion}` : 'no versions'}>
                      {j.latestVersion ? `v${j.latestVersion.split('.').slice(0, 3).join('.')}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <aside className="talend-panel__drawer">
              <div className="talend-panel__drawer-header">
                <span className="talend-panel__drawer-name">{selected.name}</span>
                <button className="talend-panel__drawer-close" onClick={() => setSelectedId(null)} aria-label="Close">×</button>
              </div>
              <div className="talend-panel__drawer-meta">
                <span>{selected.environment}</span>
                <span>·</span>
                <span>{selected.workspace}</span>
                {selected.artifactType && (<><span>·</span><span>{selected.artifactType}</span></>)}
                {selected.artifactName && (<><span>·</span><span>{selected.artifactName}</span></>)}
              </div>
              {selected.description && (
                <div className="talend-panel__drawer-desc">{selected.description}</div>
              )}
              {actionMsg && <div className="talend-panel__action-msg">{actionMsg}</div>}

              <div className="talend-panel__drawer-section">
                <div className="talend-panel__drawer-section-title">
                  Schedules ({matchedSchedules.length})
                  {matchedSchedules.length > 0 && (
                    <button
                      type="button"
                      className="talend-panel__drawer-btn"
                      style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px' }}
                      onClick={() => setEditing({ executableId: matchedSchedules[0].executableId, environmentId: matchedSchedules[0].environmentId })}
                      title="Add another schedule for this task"
                    >
                      + Add
                    </button>
                  )}
                </div>
                {matchedSchedules.length === 0 ? (
                  <div className="talend-panel__drawer-body talend-panel__muted">
                    No schedules matched this artifact (heuristic name match).
                    <br />Without an existing schedule we can't derive an executableId,
                    so creating new schedules from here isn't possible until the PAT
                    can hit <code>/orchestration/executables</code>.
                  </div>
                ) : (
                  <ul className="talend-panel__sched-list">
                    {matchedSchedules.map(s => (
                      <li key={s.id} className="talend-panel__sched-item">
                        <div className="talend-panel__sched-summary">{summarizeTrigger(s.trigger)}</div>
                        {s.description && <div className="talend-panel__sched-desc">{s.description}</div>}
                        <div className="talend-panel__sched-actions">
                          <button
                            type="button"
                            className="talend-panel__drawer-btn"
                            style={{ fontSize: 10, padding: '2px 8px' }}
                            onClick={() => setEditing({ schedule: s, executableId: s.executableId, environmentId: s.environmentId })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="talend-panel__drawer-btn"
                            style={{ fontSize: 10, padding: '2px 8px', color: 'oklch(0.65 0.22 25)' }}
                            onClick={() => deleteSchedule(s)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {editing && (
                  <ScheduleEditor
                    initial={editing.schedule}
                    executableId={editing.executableId}
                    environmentId={editing.environmentId}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setActionMsg(editing.schedule ? 'schedule updated' : 'schedule created'); setScheduleRefresh(n => n + 1); }}
                  />
                )}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
