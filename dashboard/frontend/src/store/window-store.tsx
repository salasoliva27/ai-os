import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { WindowState, WindowLayout, WindowAction, PanelId } from '../types/window';

const STORAGE_KEY = 'ai-os-window-layout-v1';
const TOPBAR_HEIGHT = 44;
const TASKBAR_HEIGHT = 34;

function vw() { return typeof window !== 'undefined' ? window.innerWidth : 1920; }
function vh() { return typeof window !== 'undefined' ? window.innerHeight - TOPBAR_HEIGHT - TASKBAR_HEIGHT : 900; }

function defaultLayout(): WindowLayout {
  const w = vw(), h = vh();
  return {
    nextZIndex: 10,
    windows: [
      {
        id: 'win-chat', title: 'Chat', type: 'chat',
        x: Math.round(w * 0.2), y: Math.round(h * 0.05),
        width: Math.round(w * 0.6), height: Math.round(h * 0.85),
        minWidth: 280, minHeight: 200,
        zIndex: 5, minimized: false, maximized: false, visible: true, closable: true, persistent: true,
      },
    ],
  };
}

const PANEL_DEFAULTS: Record<PanelId, { title: string; w: number; h: number; minW: number; minH: number }> = {
  chat:        { title: 'Chat',        w: 0.6,  h: 0.85, minW: 280, minH: 200 },
  credentials: { title: 'Credentials', w: 0.5,  h: 0.7,  minW: 320, minH: 240 },
  files:       { title: 'Files',       w: 0.55, h: 0.7,  minW: 320, minH: 240 },
  tasks:       { title: 'Tasks',       w: 0.45, h: 0.75, minW: 280, minH: 240 },
  memory:      { title: 'Memory',      w: 0.55, h: 0.7,  minW: 320, minH: 240 },
  calendar:    { title: 'Calendar',    w: 0.6,  h: 0.7,  minW: 320, minH: 240 },
  research:    { title: 'Research',    w: 0.55, h: 0.75, minW: 320, minH: 260 },
};

export function buildPanelWindow(type: PanelId, existingCount: number): WindowState {
  const d = PANEL_DEFAULTS[type];
  const w = vw(), h = vh();
  const winW = Math.round(w * d.w);
  const winH = Math.round(h * d.h);
  const offset = (existingCount % 6) * 30;
  return {
    id: `win-${type}`,
    title: d.title,
    type,
    x: Math.round((w - winW) / 2) + offset,
    y: Math.round((h - winH) / 2) + offset,
    width: winW,
    height: winH,
    minWidth: d.minW,
    minHeight: d.minH,
    zIndex: 0,
    minimized: false,
    maximized: false,
    visible: true,
    closable: true,
    persistent: true,
  };
}

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
      const existing = state.windows.find(w => w.id === action.window.id);
      if (existing) {
        return {
          ...state, nextZIndex: nz,
          windows: state.windows.map(w =>
            w.id === action.window.id
              ? { ...w, visible: true, minimized: false, zIndex: nz }
              : w
          ),
        };
      }
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

function loadLayout(): WindowLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WindowLayout;
      if (parsed.windows?.length > 0) return parsed;
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

interface WindowManagerValue {
  layout: WindowLayout;
  dispatch: (action: WindowAction) => void;
}

const WindowManagerContext = createContext<WindowManagerValue | null>(null);

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [layout, dispatch] = useReducer(windowReducer, null, loadLayout);

  useEffect(() => { saveLayout(layout); }, [layout]);

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
