import { useDashboard } from '../store';

const GROUP_LABELS: Record<string, string> = {
  wiki: 'Project',
  agents: 'Agent',
  concepts: 'Concept',
  learnings: 'Learning',
  other: 'Node',
};

const GROUP_COLORS: Record<string, string> = {
  wiki: 'oklch(0.75 0.18 180)',
  agents: 'oklch(0.72 0.18 145)',
  concepts: 'oklch(0.70 0.15 280)',
  learnings: 'oklch(0.68 0.12 85)',
  other: 'var(--color-text-muted)',
};

export function BrainNodeDrillDown() {
  const { brainNodes, brainEdges, selectedBrainNode, selectBrainNode } = useDashboard();
  const node = brainNodes.find(n => n.id === selectedBrainNode);

  if (!node) return null;

  // Find connected nodes
  const connectedIds = new Set<string>();
  for (const e of brainEdges) {
    if (e.source === node.id) connectedIds.add(e.target);
    if (e.target === node.id) connectedIds.add(e.source);
  }
  const connected = brainNodes.filter(n => connectedIds.has(n.id));

  // Group connections
  const byGroup: Record<string, typeof connected> = {};
  for (const c of connected) {
    const g = c.group || 'other';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(c);
  }

  return (
    <div className="brain-drill">
      <button className="brain-drill__close" onClick={() => selectBrainNode(null)}>x</button>

      <div className="brain-drill__header">
        <span className="brain-drill__group" style={{ color: GROUP_COLORS[node.group] || GROUP_COLORS.other }}>
          {GROUP_LABELS[node.group] || node.group}
        </span>
        <div className="brain-drill__name">{node.label}</div>
      </div>

      <div className="brain-drill__stats">
        <div className="brain-drill__stat">
          <span className="brain-drill__stat-val">{connected.length}</span>
          <span className="brain-drill__stat-label">connections</span>
        </div>
        <div className="brain-drill__stat">
          <span className="brain-drill__stat-val">{node.size.toFixed(0)}</span>
          <span className="brain-drill__stat-label">weight</span>
        </div>
      </div>

      {/* Connections grouped by type */}
      {Object.entries(byGroup).map(([group, nodes]) => (
        <div key={group} className="brain-drill__section">
          <div className="brain-drill__section-title" style={{ color: GROUP_COLORS[group] || GROUP_COLORS.other }}>
            {GROUP_LABELS[group] || group}s ({nodes.length})
          </div>
          <div className="brain-drill__links">
            {nodes.map(n => (
              <button
                key={n.id}
                className="brain-drill__link"
                onClick={() => selectBrainNode(n.id)}
              >
                <span className="brain-drill__link-dot" style={{ background: GROUP_COLORS[n.group] || GROUP_COLORS.other }} />
                {n.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {connected.length === 0 && (
        <div className="brain-drill__empty">No connections yet</div>
      )}
    </div>
  );
}
