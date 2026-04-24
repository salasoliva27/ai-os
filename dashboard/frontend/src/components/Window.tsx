import { useCallback, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useWindowManager } from '../store/window-store';
import type { WindowState } from '../types/window';
import { findSnapEdges, snapValue, findSharedEdgeWindows } from '../types/window';

interface WindowProps {
  state: WindowState;
  children: ReactNode;
}

type ResizeDir = 'e' | 'w' | 'n' | 's' | 'ne' | 'nw' | 'se' | 'sw';

const TOPBAR_H = 44;
const TASKBAR_H = 34;

export function Window({ state, children }: WindowProps) {
  const { layout, dispatch } = useWindowManager();
  const rafRef = useRef(0);

  const onFocus = useCallback(() => {
    dispatch({ type: 'FOCUS', id: state.id });
  }, [dispatch, state.id]);

  const onDragStart = useCallback((e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('.wm-window__controls')) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'FOCUS', id: state.id });

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = state.x;
    const origY = state.y;
    const winW = state.width;
    const winH = state.height;

    const snapH = { left: false, right: false };
    const snapV = { top: false, bottom: false };

    const onMove = (me: globalThis.PointerEvent) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        let newX = origX + (me.clientX - startX);
        let newY = origY + (me.clientY - startY);

        const vpW = window.innerWidth;
        const vpH = window.innerHeight - TOPBAR_H - TASKBAR_H;

        const edges = findSnapEdges(layout.windows, state.id);
        const hTargets = [0, vpW, ...edges.lefts, ...edges.rights];
        const vTargets = [0, vpH, ...edges.tops, ...edges.bottoms];

        const leftSnap = snapValue(newX, hTargets, snapH.left);
        if (leftSnap.isSnapped) { newX = leftSnap.snapped; }
        snapH.left = leftSnap.isSnapped;

        const rightSnap = snapValue(newX + winW, hTargets, snapH.right);
        if (rightSnap.isSnapped && !leftSnap.isSnapped) { newX = rightSnap.snapped - winW; }
        snapH.right = rightSnap.isSnapped;

        const topSnap = snapValue(newY, vTargets, snapV.top);
        if (topSnap.isSnapped) { newY = topSnap.snapped; }
        snapV.top = topSnap.isSnapped;

        const bottomSnap = snapValue(newY + winH, vTargets, snapV.bottom);
        if (bottomSnap.isSnapped && !topSnap.isSnapped) { newY = bottomSnap.snapped - winH; }
        snapV.bottom = bottomSnap.isSnapped;

        dispatch({ type: 'MOVE', id: state.id, x: newX, y: newY });
      });
    };

    const onUp = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [dispatch, state.id, state.x, state.y, state.width, state.height, layout.windows]);

  const onResizeStart = useCallback((dir: ResizeDir) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'FOCUS', id: state.id });

    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: state.x, y: state.y, w: state.width, h: state.height };

    const neighborsE = dir.includes('e')
      ? findSharedEdgeWindows(layout.windows, state.id, 'left', state.x + state.width)
          .map(w => ({ id: w.id, x: w.x, y: w.y, w: w.width, h: w.height }))
      : [];
    const neighborsW = dir.includes('w')
      ? findSharedEdgeWindows(layout.windows, state.id, 'right', state.x)
          .map(w => ({ id: w.id, x: w.x, y: w.y, w: w.width, h: w.height }))
      : [];
    const neighborsS = dir.includes('s')
      ? findSharedEdgeWindows(layout.windows, state.id, 'top', state.y + state.height)
          .map(w => ({ id: w.id, x: w.x, y: w.y, w: w.width, h: w.height }))
      : [];
    const neighborsN = dir.includes('n')
      ? findSharedEdgeWindows(layout.windows, state.id, 'bottom', state.y)
          .map(w => ({ id: w.id, x: w.x, y: w.y, w: w.width, h: w.height }))
      : [];

    const hasNeighbors = neighborsE.length + neighborsW.length + neighborsS.length + neighborsN.length > 0;

    const snap = { left: false, right: false, top: false, bottom: false };

    const onMove = (me: globalThis.PointerEvent) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;

        let newX = orig.x, newY = orig.y, newW = orig.w, newH = orig.h;

        if (dir.includes('e')) newW = orig.w + dx;
        if (dir.includes('w')) { newW = orig.w - dx; newX = orig.x + dx; }
        if (dir.includes('s')) newH = orig.h + dy;
        if (dir.includes('n')) { newH = orig.h - dy; newY = orig.y + dy; }

        if (newW < state.minWidth) { newW = state.minWidth; if (dir.includes('w')) newX = orig.x + orig.w - state.minWidth; }
        if (newH < state.minHeight) { newH = state.minHeight; if (dir.includes('n')) newY = orig.y + orig.h - state.minHeight; }

        if (!hasNeighbors) {
          const vpW = window.innerWidth;
          const vpH = window.innerHeight - TOPBAR_H - TASKBAR_H;
          const edges = findSnapEdges(layout.windows, state.id);
          const hTargets = [0, vpW, ...edges.lefts, ...edges.rights];
          const vTargets = [0, vpH, ...edges.tops, ...edges.bottoms];

          if (dir.includes('e')) {
            const res = snapValue(newX + newW, hTargets, snap.right);
            if (res.isSnapped) newW = res.snapped - newX;
            snap.right = res.isSnapped;
          }
          if (dir.includes('w')) {
            const res = snapValue(newX, hTargets, snap.left);
            if (res.isSnapped) { newW = newW + (newX - res.snapped); newX = res.snapped; }
            snap.left = res.isSnapped;
          }
          if (dir.includes('s')) {
            const res = snapValue(newY + newH, vTargets, snap.bottom);
            if (res.isSnapped) newH = res.snapped - newY;
            snap.bottom = res.isSnapped;
          }
          if (dir.includes('n')) {
            const res = snapValue(newY, vTargets, snap.top);
            if (res.isSnapped) { newH = newH + (newY - res.snapped); newY = res.snapped; }
            snap.top = res.isSnapped;
          }
        }

        if (!hasNeighbors) {
          dispatch({ type: 'RESIZE', id: state.id, x: newX, y: newY, width: newW, height: newH });
        } else {
          const updates: Array<{ id: string; x: number; y: number; width: number; height: number }> = [
            { id: state.id, x: newX, y: newY, width: newW, height: newH },
          ];
          for (const n of neighborsE) {
            const newNX = n.x + dx;
            const newNW = n.w - dx;
            if (newNW >= 200) updates.push({ id: n.id, x: newNX, y: n.y, width: newNW, height: n.h });
          }
          for (const n of neighborsW) {
            const newNW = n.w + dx;
            if (newNW >= 200) updates.push({ id: n.id, x: n.x, y: n.y, width: newNW, height: n.h });
          }
          for (const n of neighborsS) {
            const newNY = n.y + dy;
            const newNH = n.h - dy;
            if (newNH >= 100) updates.push({ id: n.id, x: n.x, y: newNY, width: n.w, height: newNH });
          }
          for (const n of neighborsN) {
            const newNH = n.h + dy;
            if (newNH >= 100) updates.push({ id: n.id, x: n.x, y: n.y, width: n.w, height: newNH });
          }
          dispatch({ type: 'RESIZE_BATCH', updates });
        }
      });
    };

    const onUp = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [dispatch, state, layout.windows]);

  if (state.minimized || !state.visible) return null;

  return (
    <div
      className={`wm-window ${state.maximized ? 'wm-window--maximized' : ''}`}
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
        zIndex: state.zIndex,
      }}
      onPointerDown={onFocus}
    >
      <div className="wm-window__titlebar" onPointerDown={onDragStart} onDoubleClick={() => dispatch({ type: 'MAXIMIZE', id: state.id })}>
        <span className="wm-window__title">{state.title}</span>
        <div className="wm-window__controls">
          <button
            className="wm-window__btn wm-window__btn--min"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'MINIMIZE', id: state.id }); }}
            title="Minimize"
          />
          <button
            className="wm-window__btn wm-window__btn--float"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'FLOAT', id: state.id }); }}
            title="Restore size"
          />
          <button
            className="wm-window__btn wm-window__btn--max"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'MAXIMIZE', id: state.id }); }}
            title={state.maximized ? 'Restore' : 'Maximize'}
          />
          {state.closable && (
            <button
              className="wm-window__btn wm-window__btn--close"
              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE', id: state.id }); }}
              title="Close"
            />
          )}
        </div>
      </div>

      <div className="wm-window__content">
        {children}
      </div>

      {!state.maximized && (
        <>
          <div className="wm-resize wm-resize--n" onPointerDown={onResizeStart('n')} />
          <div className="wm-resize wm-resize--s" onPointerDown={onResizeStart('s')} />
          <div className="wm-resize wm-resize--e" onPointerDown={onResizeStart('e')} />
          <div className="wm-resize wm-resize--w" onPointerDown={onResizeStart('w')} />
          <div className="wm-resize wm-resize--ne" onPointerDown={onResizeStart('ne')} />
          <div className="wm-resize wm-resize--nw" onPointerDown={onResizeStart('nw')} />
          <div className="wm-resize wm-resize--se" onPointerDown={onResizeStart('se')} />
          <div className="wm-resize wm-resize--sw" onPointerDown={onResizeStart('sw')} />
        </>
      )}
    </div>
  );
}
