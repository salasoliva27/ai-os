import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDashboard, AGENT_REGISTRY } from '../store';
import './ProcedureMap.css';

// ── Node Data Types ──

interface AgentNodeData {
  label: string;
  icon: string;
  role: string;
  description: string;
  tools: string[];
  linkedAgents: string[];
  callCount: number;
  [key: string]: unknown;
}

interface StepNodeData {
  label: string;
  stepNumber: number;
  description: string;
  mandatory: boolean;
  [key: string]: unknown;
}

interface PhaseNodeData {
  label: string;
  phase: string;
  color: string;
  [key: string]: unknown;
}

// ── Custom Nodes ──

function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const d = data as AgentNodeData;
  return (
    <div className={`pm-node pm-node--agent ${selected ? 'pm-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="pm-handle" />
      <div className="pm-node__header">
        <span className="pm-node__icon">{d.icon}</span>
        <span className="pm-node__label">{d.label}</span>
        {d.callCount > 0 && <span className="pm-node__badge">{d.callCount}</span>}
      </div>
      <div className="pm-node__role">{d.role}</div>
      {d.tools.length > 0 && (
        <div className="pm-node__tools">
          {d.tools.map(t => <span key={t} className="pm-node__tool">{t}</span>)}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="pm-handle" />
      <Handle type="source" position={Position.Right} id="right" className="pm-handle" />
      <Handle type="target" position={Position.Left} id="left" className="pm-handle" />
    </div>
  );
}

function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const d = data as StepNodeData;
  return (
    <div className={`pm-node pm-node--step ${d.mandatory ? 'pm-node--mandatory' : ''} ${selected ? 'pm-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="pm-handle" />
      <div className="pm-node__step-header">
        <span className="pm-node__step-num">{d.stepNumber}</span>
        <span className="pm-node__label">{d.label}</span>
      </div>
      <div className="pm-node__step-desc">{d.description}</div>
      <Handle type="source" position={Position.Bottom} className="pm-handle" />
      <Handle type="source" position={Position.Right} id="right" className="pm-handle" />
      <Handle type="target" position={Position.Left} id="left" className="pm-handle" />
    </div>
  );
}

function PhaseNode({ data }: NodeProps<Node<PhaseNodeData>>) {
  const d = data as PhaseNodeData;
  return (
    <div className="pm-node pm-node--phase" style={{ borderColor: d.color }}>
      <div className="pm-node__phase-label" style={{ color: d.color }}>{d.label}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  step: StepNode,
  phase: PhaseNode,
};

// ── Build Graph Data ──

function buildProcedureGraph(agentCounts: Record<string, number>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Phase nodes (large group labels)
  const phases = [
    { id: 'phase-dispatch', label: 'DISPATCH PROTOCOL', phase: 'dispatch', color: '#5fd4d4', x: 400, y: -60 },
    { id: 'phase-agents', label: 'AGENT POOL', phase: 'agents', color: '#5fd47a', x: 400, y: 520 },
    { id: 'phase-verify', label: 'VERIFICATION', phase: 'verify', color: '#d4a55f', x: 1100, y: -60 },
    { id: 'phase-output', label: 'OUTPUT ROUTING', phase: 'output', color: '#a77bdb', x: 1100, y: 520 },
  ];

  for (const p of phases) {
    nodes.push({
      id: p.id,
      type: 'phase',
      position: { x: p.x, y: p.y },
      data: { label: p.label, phase: p.phase, color: p.color },
      draggable: false,
      selectable: false,
    });
  }

  // Dispatch steps
  const dispatchSteps = [
    { id: 'step-think', num: 0, label: 'THINK FIRST', desc: 'Sequential thinking for non-trivial tasks', mandatory: true, x: 100, y: 20 },
    { id: 'step-identify', num: 1, label: 'IDENTIFY', desc: 'What kind of task is this?', mandatory: true, x: 350, y: 20 },
    { id: 'step-dispatch', num: 2, label: 'DISPATCH', desc: 'Read the agent file before doing anything', mandatory: true, x: 600, y: 20 },
    { id: 'step-lookup', num: 3, label: 'LOOKUP', desc: 'Check tools/registry.md + skills/registry.md', mandatory: true, x: 350, y: 140 },
    { id: 'step-execute', num: 4, label: 'EXECUTE', desc: 'Do the work with full context', mandatory: true, x: 600, y: 140 },
    { id: 'step-verify', num: 5, label: 'VERIFY', desc: 'Mandatory before reporting done (all layers)', mandatory: true, x: 850, y: 80 },
    { id: 'step-output', num: 6, label: 'OUTPUT', desc: 'Route results to correct destination', mandatory: true, x: 1100, y: 80 },
  ];

  for (const s of dispatchSteps) {
    nodes.push({
      id: s.id,
      type: 'step',
      position: { x: s.x, y: s.y },
      data: { label: s.label, stepNumber: s.num, description: s.desc, mandatory: s.mandatory },
    });
  }

  // Dispatch step edges
  const stepEdges: [string, string][] = [
    ['step-think', 'step-identify'],
    ['step-identify', 'step-dispatch'],
    ['step-dispatch', 'step-lookup'],
    ['step-lookup', 'step-execute'],
    ['step-execute', 'step-verify'],
    ['step-verify', 'step-output'],
  ];
  for (const [src, tgt] of stepEdges) {
    edges.push({
      id: `e-${src}-${tgt}`,
      source: src,
      target: tgt,
      sourceHandle: src === 'step-dispatch' || src === 'step-execute' ? 'right' : undefined,
      targetHandle: tgt === 'step-lookup' || tgt === 'step-verify' ? undefined : tgt === 'step-execute' ? 'left' : undefined,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#5fd4d4', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#5fd4d4', width: 16, height: 12 },
    });
  }

  // Agent nodes — arranged in a grid below dispatch
  const cols = 5;
  const agentStartX = 40;
  const agentStartY = 300;
  const colGap = 240;
  const rowGap = 200;

  AGENT_REGISTRY.forEach((agent, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodes.push({
      id: agent.id,
      type: 'agent',
      position: { x: agentStartX + col * colGap, y: agentStartY + row * rowGap },
      data: {
        label: agent.name,
        icon: agent.icon,
        role: agent.role,
        description: agent.description,
        tools: agent.tools,
        linkedAgents: agent.linkedAgents,
        callCount: agentCounts[agent.name] || 0,
      },
    });
  });

  // Connect dispatch to agents
  edges.push({
    id: 'e-dispatch-pool',
    source: 'step-dispatch',
    target: 'a-dev',
    type: 'smoothstep',
    animated: true,
    style: { stroke: '#5fd47a', strokeWidth: 1.5, strokeDasharray: '6 3' },
    label: 'routes to agent',
    labelStyle: { fill: '#5fd47a', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
    labelBgStyle: { fill: 'rgba(6, 5, 20, 0.8)' },
  });

  // Linked agent edges
  for (const agent of AGENT_REGISTRY) {
    for (const linked of agent.linkedAgents) {
      const exists = edges.find(e => e.id === `e-link-${linked}-${agent.id}`);
      if (!exists) {
        edges.push({
          id: `e-link-${agent.id}-${linked}`,
          source: agent.id,
          target: linked,
          sourceHandle: 'right',
          targetHandle: 'left',
          type: 'smoothstep',
          style: { stroke: 'rgba(167, 125, 219, 0.4)', strokeWidth: 1, strokeDasharray: '4 4' },
        });
      }
    }
  }

  // Verification layers (connected from step-verify)
  const verifyLayers = [
    { id: 'v-code', label: 'Code Review', desc: 'Read changed files, invoke /code-review', y: -20 },
    { id: 'v-server', label: 'Server Start', desc: 'Confirm it runs without errors', y: 60 },
    { id: 'v-visual', label: 'Visual Check', desc: 'Desktop + mobile via Playwright', y: 140 },
    { id: 'v-func', label: 'Functional Test', desc: 'Click through main flows', y: 220 },
    { id: 'v-cross', label: 'Cross-Env', desc: 'Check shared components', y: 300 },
    { id: 'v-security', label: 'Security Gate', desc: 'Auth, data, APIs audit', y: 380 },
  ];

  for (const v of verifyLayers) {
    nodes.push({
      id: v.id,
      type: 'step',
      position: { x: 1050, y: v.y },
      data: { label: v.label, stepNumber: 0, description: v.desc, mandatory: true },
    });
    edges.push({
      id: `e-verify-${v.id}`,
      source: 'step-verify',
      target: v.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'smoothstep',
      style: { stroke: '#d4a55f', strokeWidth: 1 },
    });
  }

  // Output destinations (connected from step-output)
  const outputs = [
    { id: 'o-github', label: 'GitHub', desc: 'Code, configs, markdown', y: -20 },
    { id: 'o-drive', label: 'Google Drive', desc: 'Client deliverables', y: 60 },
    { id: 'o-r2', label: 'Cloudflare R2', desc: 'Media, images, video', y: 140 },
    { id: 'o-vault', label: 'Obsidian Vault', desc: 'Learnings, concepts', y: 220 },
  ];

  for (const o of outputs) {
    nodes.push({
      id: o.id,
      type: 'step',
      position: { x: 1320, y: o.y },
      data: { label: o.label, stepNumber: 0, description: o.desc, mandatory: false },
    });
    edges.push({
      id: `e-output-${o.id}`,
      source: 'step-output',
      target: o.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'smoothstep',
      style: { stroke: '#a77bdb', strokeWidth: 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#a77bdb', width: 12, height: 10 },
    });
  }

  return { nodes, edges };
}

// ── Detail Panel ──

function DetailPanel({ node, onClose }: { node: Node | null; onClose: () => void }) {
  if (!node) return null;

  const d = node.data as Record<string, unknown>;

  return (
    <div className="pm-detail">
      <div className="pm-detail__header">
        <div className="pm-detail__title">
          {d.icon ? <span className="pm-detail__icon">{String(d.icon)}</span> : null}
          <span>{String(d.label)}</span>
        </div>
        <button className="pm-detail__close" onClick={onClose}>x</button>
      </div>

      {d.role ? <div className="pm-detail__role">{String(d.role)}</div> : null}
      {d.description ? <div className="pm-detail__desc">{String(d.description)}</div> : null}

      {Array.isArray(d.tools) && d.tools.length > 0 && (
        <div className="pm-detail__section">
          <div className="pm-detail__section-title">Tools</div>
          <div className="pm-detail__tags">
            {(d.tools as string[]).map(t => <span key={t} className="pm-detail__tag">{t}</span>)}
          </div>
        </div>
      )}

      {Array.isArray(d.linkedAgents) && d.linkedAgents.length > 0 && (
        <div className="pm-detail__section">
          <div className="pm-detail__section-title">Linked Agents</div>
          <div className="pm-detail__tags">
            {(d.linkedAgents as string[]).map(a => {
              const agent = AGENT_REGISTRY.find(r => r.id === a);
              return <span key={a} className="pm-detail__tag pm-detail__tag--agent">{agent?.name || a}</span>;
            })}
          </div>
        </div>
      )}

      {typeof d.callCount === 'number' && d.callCount > 0 && (
        <div className="pm-detail__stat">
          <span className="pm-detail__stat-label">Session calls</span>
          <span className="pm-detail__stat-value">{d.callCount as number}</span>
        </div>
      )}

      {d.stepNumber !== undefined && (
        <div className="pm-detail__section">
          <div className="pm-detail__section-title">Step Details</div>
          <div className="pm-detail__desc">{String(d.description)}</div>
          {d.mandatory ? <div className="pm-detail__mandatory">Mandatory step</div> : null}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

export function ProcedureMap() {
  const { centerView, setCenterView, agentCounts } = useDashboard();
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildProcedureGraph(agentCounts),
    [agentCounts]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'phase') return;
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return (
    <div className="pm-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        minZoom={0.15}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        className="pm-flow"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          className="pm-bg"
        />
        <Controls
          showInteractive={false}
          className="pm-controls"
        />
        <MiniMap
          className="pm-minimap"
        />
        <Panel position="top-left" className="pm-title-panel">
          <div className="pm-title">Procedure Map</div>
          <div className="pm-subtitle">Dispatch protocol, agent pool, verification layers</div>
        </Panel>
      </ReactFlow>

      <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />

      <div className="constellation__view-toggle">
        {(['constellation', 'brain', 'procedures', 'files'] as const).map(v => (
          <button
            key={v}
            className={`constellation__view-btn ${centerView === v ? 'constellation__view-btn--active' : ''}`}
            onClick={() => setCenterView(v)}
          >
            {v === 'files' ? 'Activity' : v === 'constellation' ? 'Projects' : v === 'procedures' ? 'Procedures' : v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
