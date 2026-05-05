import { useDashboard, AGENT_REGISTRY } from '../store';
import type { CenterView } from '../types/dashboard';

const STAGE_ORDER = ['idea', 'dev', 'uat', 'prod'] as const;
const STAGE_ICONS: Record<string, string> = { idea: '\u2727', dev: '\u2692', uat: '\u2691', prod: '\u2713' };
const STAGE_LABELS: Record<string, string> = { idea: 'IDEA', dev: 'DEV', uat: 'UAT', prod: 'PROD' };

export function FileHeatmapView() {
  const { projects, tools, agents, agentCounts, sessionEvents, learnings, centerView, setCenterView } = useDashboard();

  const activeTools = tools.filter(t => t.callCount > 0);
  const maxCalls = Math.max(...tools.map(t => t.callCount), 1);

  const views: { id: CenterView; label: string }[] = [
    { id: 'constellation', label: 'Projects' },
    { id: 'brain', label: 'Brain' },
    { id: 'procedures', label: 'Procedures' },
    { id: 'files', label: 'Activity' },
  ];

  return (
    <div className="project-grid__wrapper">
      <div className="activity-view">
        {/* Project pipeline — horizontal lanes by stage */}
      <div className="activity-view__pipeline">
        {STAGE_ORDER.map(stage => {
          const stageProjects = projects.filter(p => p.stage === stage);
          return (
            <div key={stage} className="activity-view__lane">
              <div className="activity-view__lane-header">
                <span className="activity-view__lane-icon">{STAGE_ICONS[stage]}</span>
                <span className="activity-view__lane-label">{STAGE_LABELS[stage]}</span>
                <span className="activity-view__lane-count">{stageProjects.length}</span>
              </div>
              <div className="activity-view__lane-cards">
                {stageProjects.map(p => (
                  <div key={p.id} className="activity-view__project-card" style={{ '--proj-color': p.color } as React.CSSProperties}>
                    <div className="activity-view__project-header">
                      <span className={`activity-view__health activity-view__health--${p.health}`} />
                      <span className="activity-view__project-name">{p.displayName}</span>
                    </div>
                    <div className="activity-view__project-phase">{p.currentPhase}</div>
                    <div className="activity-view__progress-bar">
                      <div className="activity-view__progress-fill" style={{ width: `${p.phaseProgress * 100}%` }} />
                    </div>
                    <div className="activity-view__project-stack">
                      {p.stack.slice(0, 3).map(s => (
                        <span key={s} className="activity-view__stack-badge">{s}</span>
                      ))}
                      {p.stack.length > 3 && <span className="activity-view__stack-badge">+{p.stack.length - 3}</span>}
                    </div>
                  </div>
                ))}
                {stageProjects.length === 0 && (
                  <div className="activity-view__lane-empty">no projects</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tool activity grid */}
      <div className="activity-view__tools-section">
        <div className="activity-view__section-title">Tool Activity</div>
        <div className="activity-view__tools-grid">
          {tools.map(t => {
            const fill = t.callCount / maxCalls;
            return (
              <div key={t.id} className={`activity-view__tool ${t.active ? 'activity-view__tool--active' : ''}`}>
                <div className="activity-view__tool-ring" style={{ '--fill': fill, '--tool-color': t.configured === 'ready' ? 'var(--color-accent)' : 'var(--color-text-muted)' } as React.CSSProperties}>
                  <svg viewBox="0 0 36 36" className="activity-view__tool-svg">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border-color)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--tool-color)" strokeWidth="3"
                      strokeDasharray={`${fill * 97.4} ${97.4 - fill * 97.4}`}
                      strokeDashoffset="24.35"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="activity-view__tool-short">{t.shortName}</span>
                </div>
                <span className="activity-view__tool-name">{t.name.replace(' MCP', '')}</span>
                <span className="activity-view__tool-count">{t.callCount}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agent Monitor */}
      <div className="agent-monitor">
        <div className="agent-monitor__title">Agents</div>
        <div className="agent-monitor__list">
          {AGENT_REGISTRY.map(ag => {
            const count = agentCounts[ag.name] || 0;
            const dispatch = agents.find(a => a.agent.toLowerCase() === ag.name.toLowerCase() && a.status !== 'done');
            const isActive = !!dispatch;

            return (
              <div
                key={ag.id}
                className={`agent-monitor__row ${isActive ? 'agent-monitor__row--active' : ''}`}
              >
                <span className={`agent-monitor__icon ${isActive ? 'agent-monitor__icon--pulse' : ''}`}>
                  {ag.icon}
                </span>
                <span className="agent-monitor__name">{ag.name}</span>
                <span className="agent-monitor__role">{ag.role.split(',')[0]}</span>
                {isActive && dispatch && (
                  <span className={`agent-monitor__status agent-monitor__status--${dispatch.status}`}>
                    {dispatch.phase}
                  </span>
                )}
                <span className="agent-monitor__count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent session events feed */}
      {sessionEvents.length > 0 && (
        <div className="activity-view__feed-section">
          <div className="activity-view__section-title">Session Feed</div>
          <div className="activity-view__feed">
            {sessionEvents.slice(0, 8).map(ev => (
              <div key={ev.id} className="activity-view__feed-item">
                <span className={`activity-view__feed-dot activity-view__feed-dot--${ev.type}`} />
                <span className="activity-view__feed-label">{ev.label}</span>
                <span className="activity-view__feed-time">{formatAge(ev.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

function formatAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
