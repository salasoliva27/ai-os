import { useDashboard } from '../store';

const STATUS_COLORS: Record<string, string> = {
  active:   'oklch(0.72 0.18 145)', // green
  paused:   'oklch(0.78 0.14 95)',  // amber
  done:     'oklch(0.78 0.16 180)', // teal
  archived: 'oklch(0.65 0.02 240)', // muted
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'oklch(0.68 0.22 25)',  // red
  P2: 'oklch(0.78 0.14 95)',  // amber
  P3: 'oklch(0.65 0.02 240)', // muted
};

function formatEffort(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 6) return `${hours}h`;
  return `${(hours / 6).toFixed(1)}d`;
}

function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${month} ${day} · ${h % 12 || 12}:${m}${ampm}`;
}

export function ProjectDrillDown() {
  const { projects, selectedProject, selectProject, scheduledEvents } = useDashboard();
  const project = projects.find(p => p.id === selectedProject);

  if (!project) return null;

  // Index scheduled events by next-step task id so each step shows its slot.
  const eventByTaskId = new Map<string, typeof scheduledEvents[number]>();
  for (const ev of scheduledEvents ?? []) {
    if (ev.projectId !== project.id) continue;
    // Scheduled event id format: sch-<projectId>-<taskId>
    const m = ev.id.match(/^sch-.+?-([a-z0-9]+)$/);
    if (m) eventByTaskId.set(m[1], ev);
  }

  return (
    <div className="drill-down">
      <button className="drill-down__close" onClick={() => selectProject(null)}>x</button>

      <div className="drill-down__header">
        <div className="drill-down__name">{project.displayName}</div>
        {project.summary && (
          <div className="drill-down__desc" style={{ fontStyle: 'italic', opacity: 0.85 }}>
            {project.summary}
          </div>
        )}
        {!project.summary && project.description && (
          <div className="drill-down__desc">{project.description}</div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <span className={`drill-down__badge drill-down__badge--${project.stage}`}>
            {project.stage}
          </span>
          {project.statusValue && (
            <span
              className="drill-down__badge"
              style={{
                background: `color-mix(in oklch, ${STATUS_COLORS[project.statusValue] ?? 'var(--color-text-muted)'} 22%, transparent)`,
                color: STATUS_COLORS[project.statusValue] ?? 'var(--color-text-muted)',
                border: `1px solid color-mix(in oklch, ${STATUS_COLORS[project.statusValue] ?? 'var(--color-text-muted)'} 40%, transparent)`,
              }}
            >
              {project.statusValue}
            </span>
          )}
          {project.hasStatusFile === false && (
            <span
              className="drill-down__badge"
              style={{ background: 'transparent', color: 'var(--color-text-muted)', border: '1px dashed var(--border-color)' }}
              title="No .janus/status.md found in this repo"
            >
              no status file
            </span>
          )}
        </div>
      </div>

      {/* Phase progress */}
      <div className="drill-down__section">
        <div className="drill-down__section-title">Current Phase</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-primary)', marginBottom: 4 }}>
          {project.currentPhase || '—'}
        </div>
        <div className="drill-down__progress-bar">
          <div className="drill-down__progress-fill" style={{ width: `${project.phaseProgress * 100}%` }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, fontFamily: 'var(--font-family-mono)' }}>
          {Math.round(project.phaseProgress * 100)}% complete
        </div>
      </div>

      {/* Next Steps from STATUS.md — shown when present, otherwise fall through
          to the legacy nextActions list further below. */}
      {project.nextSteps && project.nextSteps.length > 0 && (
        <div className="drill-down__section">
          <div className="drill-down__section-title">Next Steps</div>
          <ul className="drill-down__list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {project.nextSteps.map(step => {
              const ev = eventByTaskId.get(step.id);
              return (
                <li
                  key={step.id}
                  className="drill-down__list-item"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid color-mix(in oklch, var(--border-color) 60%, transparent)',
                    opacity: step.done ? 0.5 : 1,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 14,
                      height: 14,
                      flexShrink: 0,
                      marginTop: 2,
                      border: `1.5px solid ${step.done ? PRIORITY_COLORS[step.priority] ?? 'var(--color-text-muted)' : 'var(--border-color)'}`,
                      borderRadius: 3,
                      background: step.done ? PRIORITY_COLORS[step.priority] ?? 'transparent' : 'transparent',
                      color: 'var(--color-bg-primary)',
                      fontSize: 9,
                      fontWeight: 700,
                    }}
                  >
                    {step.done ? '✓' : ''}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-primary)', textDecoration: step.done ? 'line-through' : 'none' }}>
                      {step.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: 10, fontFamily: 'var(--font-family-mono)', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: `color-mix(in oklch, ${PRIORITY_COLORS[step.priority] ?? 'var(--color-text-muted)'} 22%, transparent)`,
                          color: PRIORITY_COLORS[step.priority] ?? 'var(--color-text-muted)',
                          fontWeight: 600,
                        }}
                      >
                        {step.priority}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{formatEffort(step.effortHours)}</span>
                      {ev ? (
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'var(--color-accent)',
                            fontWeight: 500,
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            textUnderlineOffset: 2,
                          }}
                          title={`Scheduled ${ev.start} → ${ev.end} — click to open in calendar`}
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('janus:focus-cal-event', { detail: { eventId: ev.id } }));
                          }}
                        >
                          📅 {formatScheduledTime(ev.start)}
                        </button>
                      ) : !step.done && (
                        <span style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} title="Not yet on the calendar">
                          unscheduled
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Milestones from STATUS.md */}
      {project.milestones && project.milestones.length > 0 && (
        <div className="drill-down__section">
          <div className="drill-down__section-title">Milestones</div>
          <ul className="drill-down__list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {project.milestones.map((m, i) => (
              <li
                key={i}
                className="drill-down__list-item"
                style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12 }}
              >
                <span style={{ fontFamily: 'var(--font-family-mono)', color: 'var(--color-accent)', fontSize: 10, paddingTop: 1 }}>
                  {m.date}
                </span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{m.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stack */}
      <div className="drill-down__section">
        <div className="drill-down__section-title">Stack</div>
        <div className="drill-down__stack">
          {project.stack.map(s => (
            <span key={s} className="drill-down__chip">{s}</span>
          ))}
        </div>
      </div>

      {/* Last commit */}
      <div className="drill-down__section">
        <div className="drill-down__section-title">Last Commit</div>
        <div className="drill-down__commit">
          <span style={{ color: 'var(--color-accent)' }}>{project.lastCommit.hash}</span>
          {' '}{project.lastCommit.message}
          <span style={{ marginLeft: 8, opacity: 0.5 }}>{project.lastCommit.age} ago</span>
        </div>
      </div>

      {/* Financial */}
      {(project.burn !== undefined || project.revenue !== undefined) && (
        <div className="drill-down__section">
          <div className="drill-down__section-title">Financial</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            {project.burn !== undefined && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>Burn/mo</div>
                <div style={{ color: project.burn > 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                  ${project.burn}
                </div>
              </div>
            )}
            {project.revenue !== undefined && (
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>Revenue/mo</div>
                <div style={{ color: project.revenue > 0 ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
                  ${project.revenue}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legal flags */}
      {project.legalFlags.length > 0 && (
        <div className="drill-down__section">
          <div className="drill-down__section-title">Legal Flags</div>
          <ul className="drill-down__list">
            {project.legalFlags.map(f => (
              <li key={f} className="drill-down__list-item" style={{ color: 'var(--color-text-secondary)' }}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Next actions — legacy fallback shown only when STATUS.md hasn't
          populated structured next steps. Once Next Steps is rendered above,
          this is redundant. */}
      {(!project.nextSteps || project.nextSteps.length === 0) && project.nextActions.length > 0 && (
        <div className="drill-down__section">
          <div className="drill-down__section-title">Next Actions</div>
          <ul className="drill-down__list">
            {project.nextActions.map((a, i) => (
              <li key={i} className="drill-down__list-item">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick actions */}
      <div className="drill-down__actions">
        {project.repo && (
          <a
            className="drill-down__action-btn"
            href={`https://github.com/${project.repo}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Repo
          </a>
        )}
      </div>
    </div>
  );
}
