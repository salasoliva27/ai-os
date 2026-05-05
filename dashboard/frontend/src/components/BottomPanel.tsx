import { useState, useRef, useEffect } from 'react';
import { useDashboard } from '../store';
import { CalendarPanel } from './CalendarPanel';
import { SQLConsole } from './SQLConsole';
import { TicketsPanel } from './TicketsPanel';
import { TalendPanel } from './TalendPanel';

type Tab = 'timeline' | 'calendar' | 'tickets' | 'talend' | 'learnings' | 'terminal' | 'workspace' | 'console';

const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'talend', label: 'Talend' },
  { id: 'learnings', label: 'Learnings' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'console', label: 'Console' },
];

const EVENT_COLORS: Record<string, string> = {
  edit: '#a78bfa',
  commit: '#34d399',
  dispatch: '#5eead4',
  memory: '#fbbf24',
  tool: '#60a5fa',
  push: '#f87171',
};

function timeAgoShort(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const EVENT_ICONS: Record<string, string> = {
  edit: 'E',
  commit: 'C',
  dispatch: 'D',
  memory: 'M',
  tool: 'T',
  push: 'P',
};

function SessionTimeline() {
  const { sessionEvents } = useDashboard();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, [sessionEvents.length]);

  if (sessionEvents.length === 0) {
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'var(--font-family-mono)', padding: 8 }}>waiting for session events...</div>;
  }

  return (
    <div ref={containerRef} className="session-timeline">
      {sessionEvents.slice(0, 50).map((ev, i) => {
        const color = EVENT_COLORS[ev.type] || '#888';
        return (
          <div key={ev.id} className="session-timeline__card" style={{ borderLeftColor: color }} title={ev.detail || ev.label}>
            <div className="session-timeline__card-header">
              <span className="session-timeline__card-icon" style={{ background: color }}>{EVENT_ICONS[ev.type] || '?'}</span>
              <span className="session-timeline__card-type">{ev.type}</span>
              <span className="session-timeline__card-time">{timeAgoShort(ev.timestamp)}</span>
            </div>
            <div className="session-timeline__card-label">{ev.label}</div>
            {ev.detail && <div className="session-timeline__card-detail">{ev.detail}</div>}
            {ev.project && <div className="session-timeline__card-project">{ev.project}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CapacityHeatmap() {
  const { calendarSlots } = useDashboard();
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="capacity-heatmap">
      {days.map(d => (
        <div key={d} className="capacity-heatmap__day-header">{d}</div>
      ))}
      {calendarSlots.map(slot => {
        const hue = 120 - slot.load * 120; // green->red
        const bg = `hsla(${hue}, 70%, 40%, ${0.2 + slot.load * 0.5})`;
        return (
          <div
            key={slot.date}
            className="capacity-heatmap__cell"
            style={{ background: bg }}
            title={`${slot.date}: ${Math.round(slot.load * 100)}% loaded\n${slot.items.join(', ')}`}
          >
            <div className="capacity-heatmap__cell-date">{slot.date.slice(-2)}</div>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_ICONS: Record<string, string> = {
  active: '',
  argued: '(debated)',
  revised: '(revised)',
  rejected: '(rejected)',
};

function LearningFeed() {
  const { learnings, sendChatMessage } = useDashboard();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function timeAgo(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function handleArgue(l: typeof learnings[0]) {
    sendChatMessage(`I want to argue this learning:\n\n**Rule:** ${l.rule}\n**Based on:** ${l.content}\n**Project:** ${l.project}\n\nLet's debate whether this is still the right behavioral rule.`);
  }

  return (
    <div className="learning-feed">
      {learnings.map(l => {
        const isExpanded = expandedId === l.id;
        return (
          <div key={l.id} className={`learning-feed__item learning-feed__item--${l.domain} ${l.status === 'rejected' ? 'learning-feed__item--rejected' : ''}`}>
            <div className="learning-feed__domain">
              {l.domain}
              {l.status !== 'active' && (
                <span className="learning-feed__status">{STATUS_ICONS[l.status]}</span>
              )}
              <span className="learning-feed__time">{timeAgo(l.timestamp)}</span>
            </div>
            <div className="learning-feed__rule">{l.rule}</div>
            <div className="learning-feed__meta">
              <span className="learning-feed__project">{l.project}</span>
              <span
                className="learning-feed__provenance"
                onClick={() => setExpandedId(isExpanded ? null : l.id)}
                title="Show source memories"
              >
                {l.sourceMemoryIds.length} source{l.sourceMemoryIds.length !== 1 ? 's' : ''}
              </span>
              <button
                className="learning-feed__argue"
                onClick={() => handleArgue(l)}
                title="Debate this learning in chat"
              >
                Argue
              </button>
            </div>
            {isExpanded && (
              <div className="learning-feed__evidence">
                <div className="learning-feed__evidence-label">Evidence:</div>
                <div className="learning-feed__evidence-content">{l.content}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileHeatmap() {
  const { fileActivities } = useDashboard();
  const maxChanges = Math.max(...fileActivities.map(f => f.changes), 1);

  return (
    <div className="file-heatmap">
      {fileActivities.map((f, i) => {
        const intensity = f.changes / maxChanges;
        const width = Math.max(30, f.size / 5);
        const age = (Date.now() - f.lastModified) / 604800000;
        const heat = Math.max(0.15, 1 - age);

        return (
          <div
            key={i}
            className="file-heatmap__cell"
            style={{
              width,
              height: Math.max(20, 16 + intensity * 24),
              background: f.repoColor.replace(')', ` / ${0.15 + heat * 0.4})`),
              backgroundColor: `color-mix(in oklch, var(--color-text-primary) ${(3 + intensity * 12).toFixed(1)}%, transparent)`,
            }}
            title={`${f.repo}/${f.path}\n${f.changes} changes`}
          >
            <span className="file-heatmap__cell-label">{f.path.split('/').pop()}</span>
          </div>
        );
      })}
    </div>
  );
}

function TerminalPreview() {
  const { terminalLines } = useDashboard();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines.length]);

  return (
    <div className="terminal-preview">
      {terminalLines.map((line, i) => {
        const cls = line.includes('[tool]') ? 'terminal-preview__line--tool'
          : line.includes('[error]') ? 'terminal-preview__line--error'
          : line.includes('[session]') ? 'terminal-preview__line--session'
          : 'terminal-preview__line--info';
        return (
          <div key={i} className={`terminal-preview__line ${cls}`}>{line}</div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function getPortUrl(port: number): string {
  // In Codespaces, use the forwarded URL; locally, use localhost
  const hostname = window.location.hostname;
  if (hostname.includes('.app.github.dev')) {
    // Replace the current port segment with the target port
    const base = hostname.replace(/-\d+\.app\.github\.dev$/, '');
    return `https://${base}-${port}.app.github.dev`;
  }
  return `http://localhost:${port}`;
}

function WorkspacePreview() {
  const { projects } = useDashboard();
  const [ports, setPorts] = useState<number[]>([]);
  const [activePort, setActivePort] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/ports')
      .then(r => r.json())
      .then(d => {
        if (d.ports?.length > 0) {
          setPorts(d.ports);
          if (!activePort) setActivePort(d.ports[0]);
        }
      })
      .catch(() => {});

    const interval = setInterval(() => {
      fetch('/api/ports')
        .then(r => r.json())
        .then(d => { if (d.ports) setPorts(d.ports); })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border-color)', flexShrink: 0, flexWrap: 'wrap' }}>
        {ports.map(p => (
          <button
            key={p}
            onClick={() => setActivePort(p)}
            style={{
              background: activePort === p ? 'var(--color-accent)' : 'var(--color-bg-surface)',
              color: activePort === p ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: 4, padding: '2px 8px', fontSize: 10,
              fontFamily: 'var(--font-family-mono)', cursor: 'pointer',
            }}
          >
            :{p}
          </button>
        ))}
        {ports.length === 0 && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)', padding: 4 }}>
            scanning ports...
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {projects.filter(p => p.stage !== 'idea').slice(0, 4).map(p => (
            <span
              key={p.id}
              style={{
                fontSize: 9, fontFamily: 'var(--font-family-mono)',
                color: 'var(--color-text-muted)', padding: '2px 6px',
                background: 'var(--color-bg-surface)', borderRadius: 3,
                cursor: 'pointer',
              }}
              title={`Open ${p.name} on GitHub`}
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {activePort ? (
          <iframe
            src={getPortUrl(activePort)}
            style={{ width: '100%', height: '100%', border: 'none', background: 'var(--color-bg-primary)', borderRadius: 4 }}
            title={`Port ${activePort}`}
          />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--color-text-muted)', fontSize: 12,
            fontFamily: 'var(--font-family-mono)',
          }}>
            no dev servers detected
          </div>
        )}
      </div>
    </div>
  );
}

function ConsoleTab() {
  const [tool, setTool] = useState<'supabase' | 'snowflake'>('supabase');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 4, padding: '4px 8px',
        borderBottom: '1px solid var(--border-color)', flexShrink: 0,
      }}>
        {(['supabase', 'snowflake'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTool(t)}
            style={{
              background: tool === t ? 'var(--color-accent)' : 'var(--color-bg-surface)',
              color: tool === t ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: 4, padding: '2px 10px', fontSize: 10,
              fontFamily: 'var(--font-family-mono)', cursor: 'pointer',
              textTransform: 'lowercase',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <SQLConsole key={tool} tool={tool} />
      </div>
    </div>
  );
}

export function BottomPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  const content: Record<Tab, React.ReactNode> = {
    timeline: <SessionTimeline />,
    calendar: <CalendarPanel />,
    tickets: <TicketsPanel />,
    talend: <TalendPanel />,
    learnings: <LearningFeed />,
    terminal: <TerminalPreview />,
    workspace: <WorkspacePreview />,
    console: <ConsoleTab />,
  };

  return (
    <div className="bottom-panel-switcher">
      <div className="bottom-panel-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`bottom-panel-tab ${activeTab === tab.id ? 'bottom-panel-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="bottom-panel-content">
        {content[activeTab]}
      </div>
    </div>
  );
}
