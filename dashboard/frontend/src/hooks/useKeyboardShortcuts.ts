import { useEffect } from 'react';
import { useWindowManager } from '../store/window-store';

export function useKeyboardShortcuts() {
  const { layout, dispatch } = useWindowManager();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      function toggleMinimize(id: string) {
        const win = layout.windows.find(w => w.id === id);
        if (win?.minimized) {
          dispatch({ type: 'RESTORE', id });
        } else {
          dispatch({ type: 'MINIMIZE', id });
        }
      }

      switch (e.key) {
        case 'b':
          e.preventDefault();
          toggleMinimize('win-chat');
          break;
        case 'j':
          e.preventDefault();
          toggleMinimize('win-bottom');
          break;
        case '\\':
          e.preventDefault();
          toggleMinimize('win-right');
          break;
        case 'k':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('venture-os:toggle-palette'));
          break;
        case 'p':
          if (e.shiftKey) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('venture-os:toggle-scoreboard'));
          }
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, layout.windows]);
}
