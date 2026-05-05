import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { WindowState, WindowLayout, WindowAction } from '../types/window';
import { rootColor } from '../types/window';

const STORAGE_KEY = 'venture-os-window-layout-v5';
const TOPBAR_HEIGHT = 40;
const TASKBAR_HEIGHT = 34;

function vw() { return typeof window !== 'undefined' ? window.innerWidth : 1920; }
function vh() { return typeof window !== 'undefined' ? window.innerHeight - TOPBAR_HEIGHT - TASKBAR_HEIGHT : 900; }

// ── Default tiled layout (looks like a grid but every window is independent) ──

function defaultLayout(): WindowLayout {
  const w = vw(), h = vh();
  // 3-column, 2-row tiling as starting positions
  const c0 = Math.round(w * 0.22);
  const c1 = Math.round(w * 0.48);
  const c2 = w - c0 - c1;
  const r0 = Math.round(h * 0.65);
  const r1 = h - r0;

  return {
    nextZIndex: 10,
    windows: [
      { id: 'win-chat', title: 'Chat A', type: 'chat',
        x: 0, y: 0, width: c0, height: h,
        minWidth: 200, minHeight: 150,
        zIndex: 4, minimized: false, maximized: false, visible: true, closable: true, persistent: true, sessionId: 'session-0',
        lineage: {
          depth: 0,
          label: 'Chat A',
          parentSessionId: null,
          breadcrumb: ['Chat A'],
          color: rootColor('session-0'),
          rootSessionId: 'session-0',
          rootLabel: 'A',
        } },
      { id: 'win-center', title: 'System', type: 'center',
        x: c0, y: 0, width: c1, height: r0,
        minWidth: 200, minHeight: 150,
        zIndex: 3, minimized: false, maximized: false, visible: true, closable: true, persistent: true },
      { id: 'win-bottom', title: 'Activity', type: 'bottom',
        x: c0, y: r0, width: c1, height: r1,
        minWidth: 200, minHeight: 100,
        zIndex: 2, minimized: false, maximized: false, visible: true, closable: true, persistent: true },
      { id: 'win-right', title: 'Context', type: 'right',
        x: c0 + c1, y: 0, width: c2, height: h,
        minWidth: 200, minHeight: 150,
        zIndex: 1, minimized: false, maximized: false, visible: true, closable: true, persistent: true },
    ],
  };
}

// ── Reducer ──

function windowReducer(state: WindowLayout, action: WindowAction): WindowLayout {
  switch (action.type) {
    case 'MOVE':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.id ? { ...w, x: action.x, y: action.y } : w
        ),
      };

    case 'RESIZE':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.id
            ? {
                ...w,
                x: action.x,
                y: action.y,
                width: Math.max(action.width, w.minWidth),
                height: Math.max(action.height, w.minHeight),
                maximized: false,
              }
            : w
        ),
      };

    case 'RESIZE_BATCH': {
      const map = new Map(action.updates.map(u => [u.id, u]));
      return {
        ...state,
        windows: state.windows.map(w => {
          const u = map.get(w.id);
          if (!u) return w;
          return {
            ...w,
            x: u.x, y: u.y,
            width: Math.max(u.width, w.minWidth),
            height: Math.max(u.height, w.minHeight),
            maximized: false,
          };
        }),
      };
    }

    case 'MINIMIZE':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.id ? { ...w, minimized: true } : w
        ),
      };

    case 'RESTORE': {
      const nz = state.nextZIndex + 1;
      return {
        ...state, nextZIndex: nz,
        windows: state.windows.map(w =>
          w.id === action.id ? { ...w, minimized: false, maximized: false, visible: true, zIndex: nz } : w
        ),
      };
    }

    case 'MAXIMIZE': {
      const nz = state.nextZIndex + 1;
      return {
        ...state, nextZIndex: nz,
        windows: state.windows.map(w => {
          if (w.id !== action.id) return w;
          if (w.maximized) {
            // Restore to pre-max bounds
            const b = w.preMaxBounds || { x: 50, y: 50, width: 600, height: 400 };
            return { ...w, maximized: false, zIndex: nz, ...b, preMaxBounds: undefined };
          }
          return {
            ...w, maximized: true, zIndex: nz,
            preMaxBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
            x: 0, y: 0, width: vw(), height: vh(),
          };
        }),
      };
    }

    case 'FLOAT': {
      // Restore to a centered, reasonable floating size
      const nz = state.nextZIndex + 1;
      const w = vw(), h = vh();
      const floatW = Math.round(w * 0.45);
      const floatH = Math.round(h * 0.55);
      const idx = state.windows.findIndex(win => win.id === action.id);
      const offsetX = Math.round((w - floatW) / 2) + (idx * 30);
      const offsetY = Math.round((h - floatH) / 2) + (idx * 30);
      return {
        ...state, nextZIndex: nz,
        windows: state.windows.map(win =>
          win.id === action.id
            ? { ...win, maximized: false, minimized: false, zIndex: nz,
                x: offsetX, y: offsetY, width: floatW, height: floatH,
                preMaxBounds: undefined }
            : win
        ),
      };
    }

    case 'FOCUS': {
      const nz = state.nextZIndex + 1;
      return {
        ...state, nextZIndex: nz,
        windows: state.windows.map(w =>
          w.id === action.id ? { ...w, zIndex: nz } : w
        ),
      };
    }

    case 'CLOSE': {
      // Persistent windows (core 4) are hidden so the taskbar can reopen them.
      // Non-persistent windows (forked chats, SQL consoles) are removed entirely.
      const target = state.windows.find(w => w.id === action.id);
      if (!target || !target.closable) return state;
      if (target.persistent) {
        return {
          ...state,
          windows: state.windows.map(w =>
            w.id === action.id ? { ...w, visible: false, minimized: false } : w
          ),
        };
      }
      return {
        ...state,
        windows: state.windows.filter(w => w.id !== action.id),
      };
    }

    case 'ADD': {
      const nz = state.nextZIndex + 1;
      return {
        ...state, nextZIndex: nz,
        windows: [...state.windows, { ...action.window, zIndex: nz }],
      };
    }

    case 'RESET':
      return defaultLayout();

    default:
      return state;
  }
}

// ── Persistence ──

function loadLayout(): WindowLayout {
  // Clear all old keys
  try {
    localStorage.removeItem('venture-os-window-layout');
    localStorage.removeItem('venture-os-window-layout-v2');
    localStorage.removeItem('venture-os-window-layout-v3');
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WindowLayout;
      if (parsed.windows?.length > 0) {
        return parsed;
      }
    }
  } catch { /* fall through */ }
  return defaultLayout();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveLayout(layout: WindowLayout) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* quota */ }
  }, 500);
}

// ── Context ──

interface WindowManagerValue {
  layout: WindowLayout;
  dispatch: (action: WindowAction) => void;
}

const WindowManagerContext = createContext<WindowManagerValue | null>(null);

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [layout, dispatch] = useReducer(windowReducer, null, loadLayout);

  useEffect(() => { saveLayout(layout); }, [layout]);

  // Recalc default positions on browser resize
  useEffect(() => {
    const onResize = () => dispatch({ type: 'RESET' });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <WindowManagerContext.Provider value={{ layout, dispatch }}>
      {children}
    </WindowManagerContext.Provider>
  );
}

export function useWindowManager() {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) throw new Error('useWindowManager must be used within WindowManagerProvider');
  return ctx;
}

export function useWindow(id: string): WindowState | undefined {
  const { layout } = useWindowManager();
  return layout.windows.find(w => w.id === id);
}
