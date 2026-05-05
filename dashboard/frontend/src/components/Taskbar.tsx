import { useWindowManager } from '../store/window-store';
import { VersionBadge } from './VersionBadge';

const TYPE_ICONS: Record<string, string> = {
  chat: '>',
  center: '*',
  bottom: '~',
  right: '=',
  calendar: '#',
  'sql-console': '$',
};

export function Taskbar() {
  const { layout, dispatch } = useWindowManager();

  const open = layout.windows.filter(w => w.visible && !w.minimized);
  const minimized = layout.windows.filter(w => w.visible && w.minimized);
  const closed = layout.windows.filter(w => !w.visible);

  return (
    <div className="wm-taskbar">
      <div className="wm-taskbar__windows">
        {open.map(w => (
          <button
            key={w.id}
            className="wm-taskbar__item wm-taskbar__item--active"
            onClick={() => dispatch({ type: 'FOCUS', id: w.id })}
            title={`Focus ${w.title}`}
          >
            <span className="wm-taskbar__icon">{TYPE_ICONS[w.type] || '?'}</span>
            <span className="wm-taskbar__label">{w.title}</span>
            {w.lineage && (
              <span className="wm-taskbar__depth" style={{ background: w.lineage.color }}>
                L{w.lineage.depth}
              </span>
            )}
            {w.closable && (
              <span
                className="wm-taskbar__x"
                role="button"
                title={`Close ${w.title}`}
                onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE', id: w.id }); }}
              >
                &times;
              </span>
            )}
          </button>
        ))}

        {minimized.length > 0 && <span className="wm-taskbar__separator" />}
        {minimized.map(w => (
          <button
            key={w.id}
            className="wm-taskbar__item wm-taskbar__item--minimized"
            onClick={() => dispatch({ type: 'RESTORE', id: w.id })}
            title={`Restore ${w.title}`}
          >
            <span className="wm-taskbar__restore-icon">+</span>
            <span className="wm-taskbar__label">{w.title}</span>
          </button>
        ))}

        {closed.length > 0 && <span className="wm-taskbar__separator" />}
        {closed.map(w => (
          <button
            key={w.id}
            className="wm-taskbar__item wm-taskbar__item--closed"
            onClick={() => dispatch({ type: 'RESTORE', id: w.id })}
            title={`Click to reopen ${w.title}`}
          >
            <span className="wm-taskbar__reopen-icon">+</span>
            <span className="wm-taskbar__icon">{TYPE_ICONS[w.type] || '?'}</span>
            <span className="wm-taskbar__label">{w.title}</span>
          </button>
        ))}
      </div>
      <div className="wm-taskbar__janus-wordmark" aria-label="JANUS">
        <span className="janus-wordmark__text">JANUS</span>
      </div>
      <div className="wm-taskbar__actions">
        <VersionBadge />
        <button
          className="wm-taskbar__reset"
          onClick={() => dispatch({ type: 'RESET' })}
          title="Reset layout"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
