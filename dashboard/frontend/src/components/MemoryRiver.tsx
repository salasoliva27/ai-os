import { useState, useEffect } from 'react';
import { useDashboard } from '../store';

function useTimeAgo(ts: number): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(i);
  }, []);
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function MemoryCard({ mem }: { mem: { id: string; type: string; direction: string; content: string; project?: string; timestamp: number } }) {
  const ago = useTimeAgo(mem.timestamp);
  const time = new Date(mem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`memory-river__card memory-river__card--${mem.type}`}>
      <div className="memory-river__card-type">
        {mem.type}
        <span className="memory-river__card-dir">
          {mem.direction === 'in' ? 'recalled' : 'written'}
        </span>
        <span className="memory-river__card-time">{ago} — {time}</span>
      </div>
      <div className="memory-river__card-content">{mem.content}</div>
      {mem.project && (
        <div className="memory-river__card-project">{mem.project}</div>
      )}
    </div>
  );
}

export function MemoryRiver() {
  const { memories } = useDashboard();

  return (
    <div className="memory-river">
      <div className="memory-river__header">
        Memory Stream ({memories.length})
      </div>
      {memories.map(mem => <MemoryCard key={mem.id} mem={mem} />)}
      {memories.length === 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flex: 1, color: 'var(--color-text-muted)', fontSize: 12,
          fontFamily: 'var(--font-family-mono)',
        }}>
          waiting for memory activity...
        </div>
      )}
    </div>
  );
}
