import { useState, useEffect } from 'react';

interface ThemePreset {
  id: string;
  name: string;
  vars: Record<string, string>;
  logo?: string;
}

const PRESETS: ThemePreset[] = [
  {
    id: 'dark',
    name: 'Dark',
    vars: {
      '--color-bg-primary': 'oklch(0.11 0.008 260)',
      '--color-bg-secondary': 'oklch(0.14 0.008 260)',
      '--color-bg-surface': 'oklch(0.18 0.01 260)',
      '--color-bg-elevated': 'oklch(0.22 0.01 260)',
      '--color-bg-inset': 'oklch(0.09 0.006 260)',
      '--color-text-primary': 'oklch(0.96 0.005 260)',
      '--color-text-secondary': 'oklch(0.72 0.01 260)',
      '--color-text-muted': 'oklch(0.48 0.01 260)',
      '--color-text-on-accent': 'oklch(0.13 0.01 260)',
      '--color-accent': 'oklch(0.78 0.16 180)',
      '--border-color': 'oklch(0.22 0.008 260)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    vars: {
      '--color-bg-primary': 'oklch(0.08 0.02 270)',
      '--color-bg-secondary': 'oklch(0.11 0.02 270)',
      '--color-bg-surface': 'oklch(0.15 0.025 270)',
      '--color-bg-elevated': 'oklch(0.19 0.025 270)',
      '--color-bg-inset': 'oklch(0.06 0.015 270)',
      '--color-text-primary': 'oklch(0.92 0.01 270)',
      '--color-text-secondary': 'oklch(0.68 0.015 270)',
      '--color-text-muted': 'oklch(0.45 0.015 270)',
      '--color-text-on-accent': 'oklch(0.10 0.02 270)',
      '--color-accent': 'oklch(0.72 0.20 280)',
      '--border-color': 'oklch(0.18 0.02 270)',
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    vars: {
      '--color-bg-primary': 'oklch(0.06 0.005 145)',
      '--color-bg-secondary': 'oklch(0.09 0.008 145)',
      '--color-bg-surface': 'oklch(0.13 0.01 145)',
      '--color-bg-elevated': 'oklch(0.17 0.015 145)',
      '--color-bg-inset': 'oklch(0.04 0.004 145)',
      '--color-text-primary': 'oklch(0.90 0.18 145)',
      '--color-text-secondary': 'oklch(0.70 0.12 145)',
      '--color-text-muted': 'oklch(0.45 0.08 145)',
      '--color-text-on-accent': 'oklch(0.08 0.005 145)',
      '--color-accent': 'oklch(0.80 0.22 145)',
      '--border-color': 'oklch(0.18 0.02 145)',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    vars: {
      '--color-bg-primary': 'oklch(0.08 0.015 320)',
      '--color-bg-secondary': 'oklch(0.12 0.02 320)',
      '--color-bg-surface': 'oklch(0.16 0.025 320)',
      '--color-bg-elevated': 'oklch(0.20 0.03 320)',
      '--color-bg-inset': 'oklch(0.06 0.01 320)',
      '--color-text-primary': 'oklch(0.95 0.01 60)',
      '--color-text-secondary': 'oklch(0.75 0.02 60)',
      '--color-text-muted': 'oklch(0.50 0.02 320)',
      '--color-text-on-accent': 'oklch(0.08 0.015 320)',
      '--color-accent': 'oklch(0.80 0.25 330)',
      '--border-color': 'oklch(0.22 0.03 320)',
    },
  },
  {
    id: 'bone',
    name: 'Bone',
    vars: {
      '--color-bg-primary': 'oklch(0.96 0.006 75)',
      '--color-bg-secondary': 'oklch(0.99 0.003 75)',
      '--color-bg-surface': 'oklch(0.93 0.008 75)',
      '--color-bg-elevated': 'oklch(0.89 0.012 75)',
      '--color-bg-inset': 'oklch(0.92 0.008 75)',
      '--color-text-primary': 'oklch(0.18 0.015 60)',
      '--color-text-secondary': 'oklch(0.34 0.02 60)',
      '--color-text-muted': 'oklch(0.50 0.018 70)',
      '--color-text-on-accent': 'oklch(0.99 0.003 75)',
      '--color-accent': 'oklch(0.52 0.15 55)',
      '--border-color': 'oklch(0.78 0.018 75)',
    },
  },
  {
    id: 'sand',
    name: 'Sand',
    vars: {
      '--color-bg-primary': 'oklch(0.94 0.012 85)',
      '--color-bg-secondary': 'oklch(0.97 0.008 85)',
      '--color-bg-surface': 'oklch(0.90 0.018 80)',
      '--color-bg-elevated': 'oklch(0.86 0.022 80)',
      '--color-bg-inset': 'oklch(0.91 0.015 80)',
      '--color-text-primary': 'oklch(0.18 0.025 50)',
      '--color-text-secondary': 'oklch(0.34 0.028 50)',
      '--color-text-muted': 'oklch(0.50 0.022 60)',
      '--color-text-on-accent': 'oklch(0.98 0.008 85)',
      '--color-accent': 'oklch(0.55 0.17 45)',
      '--border-color': 'oklch(0.74 0.028 80)',
    },
  },
  {
    id: 'arctic',
    name: 'Arctic',
    vars: {
      '--color-bg-primary': 'oklch(0.97 0.004 230)',
      '--color-bg-secondary': 'oklch(0.99 0.002 230)',
      '--color-bg-surface': 'oklch(0.93 0.01 230)',
      '--color-bg-elevated': 'oklch(0.89 0.015 230)',
      '--color-bg-inset': 'oklch(0.92 0.008 230)',
      '--color-text-primary': 'oklch(0.15 0.025 240)',
      '--color-text-secondary': 'oklch(0.32 0.025 240)',
      '--color-text-muted': 'oklch(0.48 0.02 235)',
      '--color-text-on-accent': 'oklch(0.99 0.003 230)',
      '--color-accent': 'oklch(0.50 0.18 240)',
      '--border-color': 'oklch(0.78 0.018 230)',
    },
  },
  {
    // Deep navy sampled from the Reece logo block. White surfaces, dark navy
    // type + accents. Hue ~258 (navy, slightly past pure blue).
    id: 'reece',
    name: 'Reece',
    logo: '/themes/reece-logo.png',
    vars: {
      '--color-bg-primary': 'oklch(0.99 0.003 258)',
      '--color-bg-secondary': 'oklch(0.97 0.006 258)',
      '--color-bg-surface': 'oklch(0.94 0.010 258)',
      '--color-bg-elevated': 'oklch(0.90 0.016 258)',
      '--color-bg-inset': 'oklch(0.95 0.007 258)',
      '--color-text-primary': 'oklch(0.22 0.085 258)',
      '--color-text-secondary': 'oklch(0.38 0.085 258)',
      '--color-text-muted': 'oklch(0.54 0.05 258)',
      '--color-text-on-accent': 'oklch(0.99 0.002 258)',
      '--color-accent': 'oklch(0.26 0.09 258)',
      '--border-color': 'oklch(0.82 0.025 258)',
    },
  },
  {
    // Cool brushed-steel — monochromatic greys with a blue-silver accent.
    // Low chroma throughout so it reads industrial rather than tinted.
    id: 'metallic',
    name: 'Metallic',
    vars: {
      '--color-bg-primary': 'oklch(0.16 0.004 240)',
      '--color-bg-secondary': 'oklch(0.20 0.005 240)',
      '--color-bg-surface': 'oklch(0.26 0.007 240)',
      '--color-bg-elevated': 'oklch(0.32 0.009 240)',
      '--color-bg-inset': 'oklch(0.12 0.003 240)',
      '--color-text-primary': 'oklch(0.94 0.003 240)',
      '--color-text-secondary': 'oklch(0.74 0.005 240)',
      '--color-text-muted': 'oklch(0.52 0.006 240)',
      '--color-text-on-accent': 'oklch(0.15 0.004 240)',
      '--color-accent': 'oklch(0.80 0.025 225)',
      '--border-color': 'oklch(0.30 0.008 240)',
    },
  },
  {
    // Polished chrome — high-lightness neutrals with a cool steel accent.
    // Companion to Metallic; same 240 hue, inverted lightness ramp.
    id: 'chrome',
    name: 'Chrome',
    vars: {
      '--color-bg-primary': 'oklch(0.95 0.004 240)',
      '--color-bg-secondary': 'oklch(0.98 0.003 240)',
      '--color-bg-surface': 'oklch(0.91 0.006 240)',
      '--color-bg-elevated': 'oklch(0.86 0.008 240)',
      '--color-bg-inset': 'oklch(0.93 0.005 240)',
      '--color-text-primary': 'oklch(0.22 0.006 240)',
      '--color-text-secondary': 'oklch(0.40 0.007 240)',
      '--color-text-muted': 'oklch(0.55 0.006 240)',
      '--color-text-on-accent': 'oklch(0.98 0.003 240)',
      '--color-accent': 'oklch(0.48 0.032 230)',
      '--border-color': 'oklch(0.80 0.008 240)',
    },
  },
  {
    // Deep cosmic void with nebula accents. Animated starfield renders via
    // ::before/::after pseudo-elements — see .has-space-backdrop in dashboard.css.
    id: 'space',
    name: 'Space',
    vars: {
      '--color-bg-primary': 'oklch(0.07 0.02 280)',
      '--color-bg-secondary': 'oklch(0.10 0.03 275)',
      '--color-bg-surface': 'oklch(0.14 0.04 275)',
      '--color-bg-elevated': 'oklch(0.19 0.05 280)',
      '--color-bg-inset': 'oklch(0.05 0.015 280)',
      '--color-text-primary': 'oklch(0.95 0.012 290)',
      '--color-text-secondary': 'oklch(0.72 0.03 285)',
      '--color-text-muted': 'oklch(0.50 0.04 280)',
      '--color-text-on-accent': 'oklch(0.08 0.02 280)',
      '--color-accent': 'oklch(0.74 0.22 330)',
      '--border-color': 'oklch(0.22 0.04 280)',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    vars: {
      '--color-bg-primary': 'oklch(0.10 0.02 25)',
      '--color-bg-secondary': 'oklch(0.14 0.025 25)',
      '--color-bg-surface': 'oklch(0.18 0.03 25)',
      '--color-bg-elevated': 'oklch(0.22 0.035 25)',
      '--color-bg-inset': 'oklch(0.08 0.015 25)',
      '--color-text-primary': 'oklch(0.93 0.015 60)',
      '--color-text-secondary': 'oklch(0.72 0.03 40)',
      '--color-text-muted': 'oklch(0.48 0.025 30)',
      '--color-text-on-accent': 'oklch(0.10 0.02 25)',
      '--color-accent': 'oklch(0.72 0.20 35)',
      '--border-color': 'oklch(0.22 0.03 25)',
    },
  },
];

// Light themes render a dark-text-on-light-bg surface; the shell needs to know
// so light-only adjustments (softer shadows, darker borders) can kick in.
const LIGHT_THEMES = new Set(['bone', 'sand', 'arctic', 'reece', 'chrome']);

const themeListeners = new Set<() => void>();

function applyTheme(preset: ThemePreset) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(preset.vars)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-theme', preset.id);
  root.setAttribute('data-theme-tone', LIGHT_THEMES.has(preset.id) ? 'light' : 'dark');
  localStorage.setItem('venture-os-theme', preset.id);
  themeListeners.forEach(l => l());
}

// ── Custom theme synthesis ────────────────────────────────
// Convert a hue + chroma + mode spec (returned by the backend) into the full
// CSS-var set our app uses. Keeps custom themes visually coherent with presets.
function buildCustomPreset(spec: {
  id: string; name: string; mode: 'light' | 'dark'; primaryHue: number; accentHue: number; chroma: number;
}): ThemePreset {
  const { mode, primaryHue: h, accentHue: ah, chroma: c } = spec;
  const cBg = Math.min(c * 0.15, 0.025); // very low chroma for bg
  const cText = Math.min(c * 0.2, 0.03);
  if (mode === 'light') {
    return {
      id: spec.id, name: spec.name,
      vars: {
        '--color-bg-primary': `oklch(0.96 ${cBg} ${h})`,
        '--color-bg-secondary': `oklch(0.99 ${cBg * 0.6} ${h})`,
        '--color-bg-surface': `oklch(0.93 ${cBg * 1.2} ${h})`,
        '--color-bg-elevated': `oklch(0.89 ${cBg * 1.6} ${h})`,
        '--color-bg-inset': `oklch(0.92 ${cBg} ${h})`,
        '--color-text-primary': `oklch(0.18 ${cText} ${h})`,
        '--color-text-secondary': `oklch(0.34 ${cText * 0.9} ${h})`,
        '--color-text-muted': `oklch(0.50 ${cText * 0.7} ${h})`,
        '--color-text-on-accent': `oklch(0.99 ${cBg * 0.4} ${h})`,
        '--color-accent': `oklch(0.52 ${c} ${ah})`,
        '--border-color': `oklch(0.78 ${cBg * 1.5} ${h})`,
      },
    };
  }
  return {
    id: spec.id, name: spec.name,
    vars: {
      '--color-bg-primary': `oklch(0.11 ${cBg} ${h})`,
      '--color-bg-secondary': `oklch(0.14 ${cBg} ${h})`,
      '--color-bg-surface': `oklch(0.18 ${cBg * 1.2} ${h})`,
      '--color-bg-elevated': `oklch(0.22 ${cBg * 1.4} ${h})`,
      '--color-bg-inset': `oklch(0.09 ${cBg * 0.8} ${h})`,
      '--color-text-primary': `oklch(0.96 ${cText * 0.3} ${h})`,
      '--color-text-secondary': `oklch(0.72 ${cText * 0.5} ${h})`,
      '--color-text-muted': `oklch(0.48 ${cText * 0.6} ${h})`,
      '--color-text-on-accent': `oklch(0.13 ${cBg} ${h})`,
      '--color-accent': `oklch(0.75 ${c} ${ah})`,
      '--border-color': `oklch(0.22 ${cBg} ${h})`,
    },
  };
}

interface CustomThemeSpec {
  id: string; name: string; mode: 'light' | 'dark';
  primaryHue: number; accentHue: number; chroma: number;
  rationale?: string; createdAt?: number;
}

export function useActiveTheme(): ThemePreset | null {
  const [id, setId] = useState<string>(() =>
    document.documentElement.getAttribute('data-theme')
    || localStorage.getItem('venture-os-theme')
    || 'dark'
  );
  const [customs, setCustoms] = useState<ThemePreset[]>([]);
  useEffect(() => {
    const update = () => setId(document.documentElement.getAttribute('data-theme') || 'dark');
    themeListeners.add(update);
    return () => { themeListeners.delete(update); };
  }, []);
  useEffect(() => {
    fetch('/api/theme/custom').then(r => r.json()).then(data => {
      const specs: CustomThemeSpec[] = data.themes || [];
      setCustoms(specs.map(buildCustomPreset));
    }).catch(() => {});
  }, []);
  return [...PRESETS, ...customs].find(p => p.id === id) || null;
}

export function useThemeInit() {
  useEffect(() => {
    const saved = localStorage.getItem('venture-os-theme') || 'dark';
    let preset = PRESETS.find(p => p.id === saved);
    if (!preset && saved.startsWith('custom-')) {
      // Try to rehydrate from backend
      fetch('/api/theme/custom').then(r => r.json()).then(data => {
        const spec = (data.themes || []).find((t: CustomThemeSpec) => t.id === saved);
        if (spec) applyTheme(buildCustomPreset(spec));
      }).catch(() => {});
    } else if (preset) {
      applyTheme(preset);
    }
  }, []);
}

function CustomThemeBuilder({ onCreated, onCancel }: { onCreated: (p: ThemePreset) => void; onCancel: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [hint, setHint] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'error'>('idle');
  const [error, setError] = useState('');
  const [rationale, setRationale] = useState('');

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter(f => f.size <= 25 * 1024 * 1024);
    setFiles(f => [...f, ...arr]);
  }

  async function analyze() {
    if (files.length === 0) return;
    setStatus('uploading'); setError('');
    const paths: string[] = [];
    for (const file of files) {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const resp = await fetch('/api/chat/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, type: file.type, data }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) { setStatus('error'); setError(json.error || `Upload failed: ${file.name}`); return; }
      paths.push(json.path);
    }
    setStatus('analyzing');
    const resp = await fetch('/api/theme/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, hint: hint.trim() || undefined }),
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) { setStatus('error'); setError(json.error || 'Analysis failed'); return; }
    const preset = buildCustomPreset(json.theme);
    setRationale(json.theme.rationale || '');
    applyTheme(preset);
    onCreated(preset);
  }

  const busy = status === 'uploading' || status === 'analyzing';

  return (
    <div className="theme-engine__builder">
      <div className="theme-engine__builder-title">Create from your brand</div>
      <div className="theme-engine__builder-hint">
        Drop your logo, brand guidelines (PDF), or a screenshot of your existing app.
        The active engine will read them and generate a matching theme.
      </div>
      <div
        className="theme-engine__drop"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
        onClick={() => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.multiple = true;
          inp.onchange = () => { if (inp.files) addFiles(inp.files); };
          inp.click();
        }}
      >
        {files.length === 0
          ? <span style={{ color: 'var(--color-text-muted)' }}>Drop files or click to browse</span>
          : <div className="theme-engine__files">
              {files.map((f, i) => (
                <span key={i} className="theme-engine__file-chip">
                  {f.type.startsWith('image/') ? '🖼' : f.type.includes('pdf') ? '📄' : '📎'} {f.name}
                  <button onClick={e => { e.stopPropagation(); setFiles(fs => fs.filter((_, j) => j !== i)); }}>×</button>
                </span>
              ))}
            </div>
        }
      </div>
      <input
        className="theme-engine__hint-input"
        placeholder="Optional: any brand color codes or vibe hints…"
        value={hint}
        onChange={e => setHint(e.target.value)}
        disabled={busy}
      />
      <div className="theme-engine__builder-actions">
        <button onClick={onCancel} disabled={busy} className="theme-engine__builder-cancel">Cancel</button>
        <button onClick={analyze} disabled={busy || files.length === 0} className="theme-engine__builder-go">
          {status === 'uploading' ? 'Uploading…' : status === 'analyzing' ? 'Analyzing…' : 'Analyze & Apply'}
        </button>
      </div>
      {error && <div className="theme-engine__builder-error">{error}</div>}
      {rationale && <div className="theme-engine__builder-rationale">{rationale}</div>}
    </div>
  );
}

export function ThemeEngine({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(() => localStorage.getItem('venture-os-theme') || 'dark');
  const [customPresets, setCustomPresets] = useState<ThemePreset[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    fetch('/api/theme/custom').then(r => r.json()).then(data => {
      const specs: CustomThemeSpec[] = data.themes || [];
      setCustomPresets(specs.map(buildCustomPreset));
    }).catch(() => {});
  }, []);

  function selectPreset(preset: ThemePreset) {
    applyTheme(preset);
    setActive(preset.id);
  }

  const allPresets = [...PRESETS, ...customPresets];

  return (
    <div className="theme-engine" onClick={onClose}>
      <div className="theme-engine__box" onClick={e => e.stopPropagation()}>
        <div className="theme-engine__title">Theme Engine</div>
        <div className="theme-engine__presets">
          {allPresets.map(p => (
            <button
              key={p.id}
              className={`theme-engine__preset ${active === p.id ? 'theme-engine__preset--active' : ''}`}
              onClick={() => selectPreset(p)}
            >
              <div className="theme-engine__preview">
                <div style={{ background: p.vars['--color-bg-primary'], flex: 1 }} />
                <div style={{ background: p.vars['--color-bg-secondary'], flex: 1 }} />
                <div style={{ background: p.vars['--color-accent'], flex: 0.5 }} />
              </div>
              <span>{p.name}</span>
            </button>
          ))}
          <button
            className="theme-engine__preset theme-engine__preset--add"
            onClick={() => setBuilderOpen(v => !v)}
            title="Create a theme from your brand assets"
          >
            <div className="theme-engine__preview theme-engine__preview--add">+</div>
            <span>{builderOpen ? 'Close' : 'Custom'}</span>
          </button>
        </div>
        {builderOpen && (
          <CustomThemeBuilder
            onCreated={p => {
              setCustomPresets(cs => [...cs, p]);
              setActive(p.id);
              setBuilderOpen(false);
            }}
            onCancel={() => setBuilderOpen(false)}
          />
        )}
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)', marginTop: 12 }}>
          Theme persists across sessions
        </div>
      </div>
    </div>
  );
}
