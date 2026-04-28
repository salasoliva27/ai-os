import type { ReactNode } from 'react';
import { useWindowManager } from '../store/window-store';
import { Window } from './Window';
import { Taskbar } from './Taskbar';
import type { PanelId, WindowState } from '../types/window';

export interface PanelRegistryEntry {
  render: () => ReactNode;
}

export type PanelRegistry = Partial<Record<PanelId, PanelRegistryEntry>>;

interface WindowShellProps {
  panels: PanelRegistry;
  brand: string;
}

export function WindowShell({ panels, brand }: WindowShellProps) {
  const { layout } = useWindowManager();

  function renderWindowContent(win: WindowState) {
    const entry = panels[win.type];
    if (entry) return entry.render();
    return (
      <div style={{ padding: 16, color: 'var(--muted)' }}>
        Panel <code>{win.type}</code> is enabled but no renderer is registered yet.
        Add a panel component and register it in <code>App.tsx</code>.
      </div>
    );
  }

  return (
    <div className="wm-shell">
      <div className="wm-viewport">
        {layout.windows.map(win => (
          <Window key={win.id} state={win}>
            {renderWindowContent(win)}
          </Window>
        ))}
      </div>
      <Taskbar brand={brand} />
    </div>
  );
}
