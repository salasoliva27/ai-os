import { useDashboard } from '../store';
import type { CenterView } from '../types/dashboard';

const STAGE_ICON: Record<string, string> = { idea: '\u2727', dev: '\u2692', uat: '\u2691', prod: '\u2713' };

export function Constellation() {
  const { projects, agents, sessionEvents, selectProject, centerView, setCenterView, projectCounts, scheduledEvents } = useDashboard();

  // Build a set of scheduled task IDs per project so we can mark next-step
  // items that already have a calendar slot. Scheduled event ids follow
  // `sch-<projectId>-<taskId>` (see scheduler.ts). Defensive default in case
  // a tab loaded an older persisted state that predates this field.
  const scheduledTaskKeys = new Set<string>();
  for (const ev of (scheduledEvents ?? [])) {
    const m = ev.id.match(/^sch-(.+?)-(.+)$/);
    if (m) scheduledTaskKeys.add(`${m[1]}|${m[2]}`);
  }

  // Determine which projects are currently active (agent working on them)
  const activeMap = new Map<string, { agent: string; phase: string; message: string; status: string }>();
  for (const a of agents) {
    if (a.status !== 'done') {
      // Match agent.project to project.name or project.displayName
      const match = projects.find(p =>
        p.name === a.project || p.displayName === a.project || p.id === a.project
      );
      if (match) {
        activeMap.set(match.id, { agent: a.agent, phase: a.phase, message: a.message, status: a.status });
      }
    }
  }

  // Also check recent session events for project activity (last 30s)
  const recentCutoff = Date.now() - 30000;
  for (const ev of sessionEvents) {
    if (ev.project && ev.timestamp > recentCutoff) {
      const match = projects.find(p => p.name === ev.project || p.id === ev.project);
      if (match && !activeMap.has(match.id)) {
        activeMap.set(match.id, { agent: ev.type, phase: '', message: ev.label, status: 'executing' });
      }
    }
  }

  const views: { id: CenterView; label: string }[] = [
    { id: 'constellation', label: 'Projects' },
    { id: 'brain', label: 'Brain' },
    { id: 'procedures', label: 'Procedures' },
    { id: 'files', label: 'Activity' },
  ];

  return (
    <div className="project-grid__wrapper">
      <div className="project-grid">
        <div className="project-grid__tiles">
          {projects.map(p => {
          const active = activeMap.get(p.id);
          const isActive = !!active;
          const count = projectCounts[p.id] || 0;

          const accountClass = p.account ? `project-grid__tile--account-${p.account}` : '';
          return (
            <div
              key={p.id}
              className={`project-grid__tile ${accountClass} ${isActive ? 'project-grid__tile--active' : ''}`}
              style={{ '--proj-color': p.color } as React.CSSProperties}
              onClick={() => selectProject(p.id)}
              title={p.owner ? `${p.owner}/${p.name}` : p.name}
            >
              {/* Glow layer for active projects */}
              {isActive && <div className="project-grid__glow" />}

              <div className="project-grid__tile-top">
                <span className={`project-grid__icon ${isActive ? 'project-grid__icon--pulse' : ''}`}>
                  {STAGE_ICON[p.stage] || '\u2727'}
                </span>
                <span className={`project-grid__health project-grid__health--${p.health}`} />
                {p.account && (
                  <span className={`project-grid__account project-grid__account--${p.account}`}>
                    {p.account}
                  </span>
                )}
                {count > 0 && (
                  <span className="project-grid__count">{count}</span>
                )}
              </div>

              <div className="project-grid__name">{p.displayName}</div>
              <div className="project-grid__stage">{p.stage.toUpperCase()}</div>

              {/* Progress bar */}
              <div className="project-grid__progress">
                <div className="project-grid__progress-fill" style={{ width: `${p.phaseProgress * 100}%` }} />
              </div>
              <div className="project-grid__phase">{p.currentPhase || (p.hasStatusFile === false ? 'no .janus/status.md yet' : ' ')}</div>

              {/* Summary from STATUS.md */}
              {p.summary && (
                <div className="project-grid__summary">{p.summary}</div>
              )}

              {/* Next steps from STATUS.md (top 3 open items). 'sch' badge
                  marks tasks Janus has already placed on the calendar. */}
              {p.nextSteps && p.nextSteps.filter(t => !t.done).length > 0 && (
                <ul className="project-grid__next">
                  {p.nextSteps.filter(t => !t.done).slice(0, 3).map(t => {
                    const isScheduled = scheduledTaskKeys.has(`${p.id}|${t.id}`);
                    return (
                      <li key={t.id} className="project-grid__next-item">
                        <span className={`project-grid__next-pri project-grid__next-pri--${t.priority.toLowerCase()}`}>{t.priority}</span>
                        <span className="project-grid__next-title">{t.title}</span>
                        {isScheduled && (
                          <span className="project-grid__next-sched" title="On the calendar">sch</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Empty-state hint when no STATUS.md exists */}
              {p.hasStatusFile === false && (!p.nextSteps || p.nextSteps.length === 0) && (
                <div className="project-grid__empty">
                  No <code>.janus/status.md</code> in this repo yet.
                </div>
              )}

              {/* Latest milestone */}
              {p.milestones && p.milestones.length > 0 && (
                <div className="project-grid__milestone">
                  <span className="project-grid__milestone-icon">✓</span>
                  <span className="project-grid__milestone-date">{p.milestones[0].date}</span>
                  <span className="project-grid__milestone-text">{p.milestones[0].description}</span>
                </div>
              )}

              {/* Stack badges */}
              <div className="project-grid__stack">
                {p.stack.slice(0, 3).map(s => (
                  <span key={s} className="project-grid__stack-pill">{s}</span>
                ))}
              </div>

              {/* Active agent overlay */}
              {isActive && active && (
                <div className="project-grid__agent-bar">
                  <span className="project-grid__agent-dot" />
                  <span className="project-grid__agent-name">{active.agent}</span>
                  {active.phase && <span className="project-grid__agent-phase">{active.phase}</span>}
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>

      <div className="constellation__view-toggle">
        {views.map(v => (
          <button
            key={v.id}
            className={`constellation__view-btn ${centerView === v.id ? 'constellation__view-btn--active' : ''}`}
            onClick={() => setCenterView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
