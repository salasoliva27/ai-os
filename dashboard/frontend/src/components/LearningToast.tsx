import { useEffect, useState, useRef } from 'react';
import { useDashboard } from '../store';
import type { MemoryEntry } from '../types/dashboard';

const TYPE_LABELS: Record<string, string> = {
  learning: 'LEARNED',
  decision: 'DECIDED',
  recall: 'RECALLED',
  context: 'CONTEXT',
};

const TYPE_ICONS: Record<string, string> = {
  learning: '\u2731',  // ✱
  decision: '\u2736',  // ✶
  recall: '\u21BB',    // ↻
  context: '\u2609',   // ☉
};

interface Toast {
  id: string;
  mem: MemoryEntry;
  exiting: boolean;
}

export function LearningToast() {
  const { memories } = useDashboard();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevCountRef = useRef(memories.length);

  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = memories.length;

    // New memories are prepended — check if count increased
    if (memories.length > prevCount) {
      const newCount = memories.length - prevCount;
      const newMems = memories.slice(0, newCount);

      for (const mem of newMems) {
        const toast: Toast = { id: mem.id, mem, exiting: false };
        setToasts(prev => [...prev, toast].slice(-4)); // max 4 visible

        // Start exit animation after 4s
        setTimeout(() => {
          setToasts(prev => prev.map(t => t.id === toast.id ? { ...t, exiting: true } : t));
        }, 4000);

        // Remove after exit animation
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, 4500);
      }
    }
  }, [memories]);

  if (toasts.length === 0) return null;

  return (
    <div className="learning-toast__container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`learning-toast ${t.exiting ? 'learning-toast--exit' : ''} learning-toast--${t.mem.type}`}
        >
          <span className="learning-toast__icon">{TYPE_ICONS[t.mem.type] || '\u2731'}</span>
          <div className="learning-toast__body">
            <span className="learning-toast__label">
              {TYPE_LABELS[t.mem.type] || 'MEMORY'}
              <span className="learning-toast__dir">
                {t.mem.direction === 'in' ? 'read' : 'written'}
              </span>
            </span>
            <span className="learning-toast__content">{t.mem.content}</span>
          </div>
          {t.mem.project && (
            <span className="learning-toast__project">{t.mem.project}</span>
          )}
        </div>
      ))}
    </div>
  );
}
