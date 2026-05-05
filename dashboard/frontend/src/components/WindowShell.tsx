import { useEffect } from 'react';
import { useWindowManager } from '../store/window-store';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useDashboard } from '../store';
import { Window } from './Window';
import { Taskbar } from './Taskbar';
import '../styles/window-manager.css';
import { ChatPanel } from './ChatPanel';
import { Constellation } from './Constellation';
import { ObsidianBrain } from './ObsidianBrain';
import { FileHeatmapView } from './FileHeatmapView';
import { ProcedureMap } from './ProcedureMap';
import { CalendarPanel } from './CalendarPanel';
import { TicketsPanel } from './TicketsPanel';
import { RightPanel } from './RightPanel';
import { ToolPulseBar } from './ToolPulseBar';
import { BottomPanel } from './BottomPanel';
import { SQLConsole } from './SQLConsole';
import { rootColor } from '../types/window';
import type { WindowState } from '../types/window';

function CenterContent() {
  const { centerView } = useDashboard();
  if (centerView === 'brain') return <ObsidianBrain />;
  if (centerView === 'procedures') return <ProcedureMap />;
  if (centerView === 'files') return <FileHeatmapView />;
  return <Constellation />;
}

function BottomContent() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ToolPulseBar />
      <div style={{ flex: 1, minHeight: 0 }}>
        <BottomPanel />
      </div>
    </div>
  );
}

function renderWindowContent(win: WindowState) {
  switch (win.type) {
    case 'chat': {
      const label = win.lineage
        ? `L${win.lineage.depth} · ${win.lineage.breadcrumb.join(' > ')}`
        : undefined;
      return (
        <ChatPanel
          sessionId={win.sessionId || 'session-0'}
          lineageLabel={label}
          lineageColor={win.lineage?.color}
        />
      );
    }
    case 'center':
      return <CenterContent />;
    case 'bottom':
      return <BottomContent />;
    case 'right':
      return <RightPanel />;
    case 'calendar':
      return <CalendarPanel />;
    case 'tickets':
      return <TicketsPanel />;
    case 'sql-console':
      return <SQLConsole tool={win.consoleTool || 'supabase'} />;
    default:
      return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>Window: {win.type}</div>;
  }
}

export function WindowShell() {
  const { layout, dispatch } = useWindowManager();
  useKeyboardShortcuts();

  // Listen for fork-chat / new-chat events from the store
  useEffect(() => {
    function handleFork(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.sessionId) return;

      const depth = detail.depth || 1;
      const rootSid = detail.rootSessionId || detail.parentSessionId || 'session-0';
      const rootLabel = detail.rootLabel;
      const color = rootColor(rootSid);
      const parentLabel = rootLabel ? `Chat ${rootLabel}` : 'Main';

      const vw = window.innerWidth;
      const vh = window.innerHeight - 40 - 34;

      const newWin: WindowState = {
        id: `win-chat-${detail.sessionId}`,
        title: rootLabel ? `${rootLabel}·${depth} ${detail.label || ''}`.trim() : (detail.label || 'Fork'),
        type: 'chat',
        x: Math.round(vw * 0.2) + (layout.windows.length * 30),
        y: Math.round(vh * 0.1) + (layout.windows.length * 30),
        width: Math.round(vw * 0.4),
        height: Math.round(vh * 0.5),
        minWidth: 200,
        minHeight: 150,
        zIndex: 0,
        minimized: false,
        maximized: false,
        visible: true,
        closable: true,
        sessionId: detail.sessionId,
        lineage: {
          depth,
          label: detail.label || 'Fork',
          parentSessionId: detail.parentSessionId || 'session-0',
          breadcrumb: [parentLabel, detail.label || 'Fork'],
          color,
          rootSessionId: rootSid,
          rootLabel,
        },
      };

      dispatch({ type: 'ADD', window: newWin });
    }

    function handleNewChat(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.sessionId) return;

      const rootSid: string = detail.rootSessionId || detail.sessionId;
      const rootLabel: string = detail.rootLabel || '?';
      const color = rootColor(rootSid);

      const vw = window.innerWidth;
      const vh = window.innerHeight - 40 - 34;

      const newWin: WindowState = {
        id: `win-chat-${detail.sessionId}`,
        title: `Chat ${rootLabel}`,
        type: 'chat',
        x: Math.round(vw * 0.18) + (layout.windows.length * 30),
        y: Math.round(vh * 0.08) + (layout.windows.length * 30),
        width: Math.round(vw * 0.4),
        height: Math.round(vh * 0.55),
        minWidth: 200,
        minHeight: 150,
        zIndex: 0,
        minimized: false,
        maximized: false,
        visible: true,
        closable: true,
        sessionId: detail.sessionId,
        lineage: {
          depth: 0,
          label: `Chat ${rootLabel}`,
          parentSessionId: null,
          breadcrumb: [`Chat ${rootLabel}`],
          color,
          rootSessionId: rootSid,
          rootLabel,
        },
      };

      dispatch({ type: 'ADD', window: newWin });
    }

    window.addEventListener('venture-os:fork-chat', handleFork);
    window.addEventListener('venture-os:new-chat', handleNewChat);

    function handleOpenSqlConsole(e: Event) {
      const detail = (e as CustomEvent).detail as { tool?: 'supabase' | 'snowflake' };
      const tool = detail?.tool === 'snowflake' ? 'snowflake' : 'supabase';
      const winId = `win-sql-${tool}`;

      const existing = layout.windows.find(w => w.id === winId);
      if (existing) {
        // Focus + restore if minimized
        dispatch({ type: 'RESTORE', id: winId });
        dispatch({ type: 'FOCUS', id: winId });
        return;
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight - 40 - 34;
      const w = Math.round(vw * 0.55);
      const h = Math.round(vh * 0.65);

      const newWin: WindowState = {
        id: winId,
        title: `${tool === 'supabase' ? 'Supabase' : 'Snowflake'} SQL`,
        type: 'sql-console',
        consoleTool: tool,
        x: Math.round((vw - w) / 2) + (layout.windows.length * 20),
        y: Math.round((vh - h) / 2) + (layout.windows.length * 20),
        width: w,
        height: h,
        minWidth: 420,
        minHeight: 280,
        zIndex: 0,
        minimized: false,
        maximized: false,
        visible: true,
        closable: true,
      };
      dispatch({ type: 'ADD', window: newWin });
    }
    window.addEventListener('venture-os:open-sql-console', handleOpenSqlConsole);

    return () => {
      window.removeEventListener('venture-os:fork-chat', handleFork);
      window.removeEventListener('venture-os:new-chat', handleNewChat);
      window.removeEventListener('venture-os:open-sql-console', handleOpenSqlConsole);
    };
  }, [dispatch, layout.windows]);

  return (
    <div className="wm-shell">
      <div className="wm-viewport">
        {layout.windows.map(win => (
          <Window key={win.id} state={win}>
            {renderWindowContent(win)}
          </Window>
        ))}
      </div>
      <Taskbar />
    </div>
  );
}
