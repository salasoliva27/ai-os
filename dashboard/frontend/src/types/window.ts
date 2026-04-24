export type PanelId =
  | 'chat'
  | 'credentials'
  | 'files'
  | 'tasks'
  | 'memory'
  | 'calendar'
  | 'research';

export interface WindowState {
  id: string;
  title: string;
  type: PanelId;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  visible: boolean;
  closable: boolean;
  persistent?: boolean;
  preMaxBounds?: { x: number; y: number; width: number; height: number };
}

export interface WindowLayout {
  windows: WindowState[];
  nextZIndex: number;
}

export type WindowAction =
  | { type: 'MOVE'; id: string; x: number; y: number }
  | { type: 'RESIZE'; id: string; x: number; y: number; width: number; height: number }
  | { type: 'RESIZE_BATCH'; updates: Array<{ id: string; x: number; y: number; width: number; height: number }> }
  | { type: 'MINIMIZE'; id: string }
  | { type: 'RESTORE'; id: string }
  | { type: 'MAXIMIZE'; id: string }
  | { type: 'FLOAT'; id: string }
  | { type: 'FOCUS'; id: string }
  | { type: 'CLOSE'; id: string }
  | { type: 'ADD'; window: WindowState }
  | { type: 'RESET' };

export const SNAP_THRESHOLD = 12;
export const RELEASE_THRESHOLD = 35;

export function findSnapEdges(
  windows: WindowState[],
  excludeId: string,
): { lefts: number[]; rights: number[]; tops: number[]; bottoms: number[] } {
  const lefts: number[] = [];
  const rights: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const w of windows) {
    if (w.id === excludeId || w.minimized || w.maximized || !w.visible) continue;
    lefts.push(w.x);
    rights.push(w.x + w.width);
    tops.push(w.y);
    bottoms.push(w.y + w.height);
  }
  return { lefts, rights, tops, bottoms };
}

export function snapValue(
  val: number,
  edges: number[],
  wasSnapped: boolean,
): { snapped: number; isSnapped: boolean } {
  const threshold = wasSnapped ? RELEASE_THRESHOLD : SNAP_THRESHOLD;
  let closest = val;
  let minDist = Infinity;
  for (const e of edges) {
    const d = Math.abs(val - e);
    if (d < minDist) { minDist = d; closest = e; }
  }
  if (minDist <= threshold) {
    return { snapped: closest, isSnapped: true };
  }
  return { snapped: val, isSnapped: false };
}

const SHARED_EDGE_TOL = 3;

export function findSharedEdgeWindows(
  windows: WindowState[],
  excludeId: string,
  edge: 'top' | 'bottom' | 'left' | 'right',
  edgeValue: number,
): WindowState[] {
  return windows.filter(w => {
    if (w.id === excludeId || w.minimized || w.maximized || !w.visible) return false;
    let wEdge: number;
    switch (edge) {
      case 'top': wEdge = w.y; break;
      case 'bottom': wEdge = w.y + w.height; break;
      case 'left': wEdge = w.x; break;
      case 'right': wEdge = w.x + w.width; break;
    }
    return Math.abs(wEdge - edgeValue) <= SHARED_EDGE_TOL;
  });
}
