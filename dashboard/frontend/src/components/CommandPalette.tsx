import { useState, useEffect, useRef } from 'react';
import { useDashboard } from '../store';

interface PaletteItem {
  icon: string;
  label: string;
  hint: string;
  action: () => void;
}

export function CommandPalette() {
  const { commandPaletteOpen, toggleCommandPalette, projects, selectProject, setCenterView, toggleScoreboard } = useDashboard();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  const items: PaletteItem[] = [
    // Projects
    ...projects.map(p => ({
      icon: p.stage === 'prod' ? '>' : p.stage === 'uat' ? '~' : '.',
      label: p.displayName,
      hint: p.stage,
      action: () => { selectProject(p.id); toggleCommandPalette(); },
    })),
    // Views
    { icon: '*', label: 'Constellation View', hint: 'center', action: () => { setCenterView('constellation'); toggleCommandPalette(); } },
    { icon: '#', label: 'Brain View', hint: 'center', action: () => { setCenterView('brain'); toggleCommandPalette(); } },
    { icon: '%', label: 'Activity Dashboard', hint: 'center', action: () => { setCenterView('files'); toggleCommandPalette(); } },
    // Actions
    { icon: '!', label: 'Portfolio Scoreboard', hint: 'Ctrl+P', action: () => { toggleScoreboard(); toggleCommandPalette(); } },
    { icon: '?', label: 'Status Overview', hint: 'all projects', action: () => { toggleScoreboard(); toggleCommandPalette(); } },
  ];

  const filtered = query
    ? items.filter(i => i.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      toggleCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      filtered[selectedIdx].action();
    }
  }

  return (
    <div className="cmd-palette" onClick={toggleCommandPalette}>
      <div className="cmd-palette__box" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-palette__input"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search projects, views, actions..."
        />
        <div className="cmd-palette__results">
          {filtered.map((item, i) => (
            <div
              key={`${item.label}-${i}`}
              className={`cmd-palette__item ${i === selectedIdx ? 'cmd-palette__item--selected' : ''}`}
              onClick={item.action}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="cmd-palette__item-icon">{item.icon}</span>
              <span className="cmd-palette__item-label">{item.label}</span>
              <span className="cmd-palette__item-hint">{item.hint}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
              No results for "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
