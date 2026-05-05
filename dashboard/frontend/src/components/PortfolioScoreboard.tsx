import { useDashboard } from '../store';

export function PortfolioScoreboard() {
  const { scoreboardOpen, toggleScoreboard, projects } = useDashboard();

  if (!scoreboardOpen) return null;

  return (
    <div className="scoreboard" onClick={toggleScoreboard}>
      <button className="scoreboard__close" onClick={toggleScoreboard}>x</button>
      <div className="scoreboard__title">Portfolio Health</div>
      <div className="scoreboard__grid" onClick={e => e.stopPropagation()}>
        {projects.map((p, i) => (
          <div key={p.id} className="scoreboard__card" style={{ animationDelay: `${i * 0.08}s` }}>
            <div className="scoreboard__card-name">
              <span className={`scoreboard__rag scoreboard__rag--${p.health}`} style={{ marginRight: 8 }} />
              {p.displayName}
            </div>

            <div className="scoreboard__metric">
              <span className="scoreboard__metric-label">Stage</span>
              <span>{p.stage.toUpperCase()}</span>
            </div>

            <div className="scoreboard__metric">
              <span className="scoreboard__metric-label">Phase Progress</span>
              <span>{Math.round(p.phaseProgress * 100)}%</span>
            </div>

            <div className="scoreboard__metric">
              <span className="scoreboard__metric-label">Last Commit</span>
              <span>{p.lastCommit.age} ago</span>
            </div>

            <div className="scoreboard__metric">
              <span className="scoreboard__metric-label">Code Health</span>
              <span className={`scoreboard__rag scoreboard__rag--${p.health}`} />
            </div>

            {(p.burn !== undefined && p.burn > 0) && (
              <div className="scoreboard__metric">
                <span className="scoreboard__metric-label">Burn</span>
                <span style={{ color: 'var(--color-danger)' }}>${p.burn}/mo</span>
              </div>
            )}

            {(p.revenue !== undefined && p.revenue > 0) && (
              <div className="scoreboard__metric">
                <span className="scoreboard__metric-label">Revenue</span>
                <span style={{ color: 'var(--color-success)' }}>${p.revenue}/mo</span>
              </div>
            )}

            {p.legalFlags.length > 0 && (
              <div className="scoreboard__metric">
                <span className="scoreboard__metric-label">Legal</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{p.legalFlags.length} flag(s)</span>
              </div>
            )}

            <div className="scoreboard__metric">
              <span className="scoreboard__metric-label">Deploy Status</span>
              <span>{p.stage === 'prod' ? 'Live' : p.stage === 'uat' ? 'Staging' : 'Dev only'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
