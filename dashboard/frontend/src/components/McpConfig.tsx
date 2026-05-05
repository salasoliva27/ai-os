import { useEffect, useState } from 'react';

interface EnvVarEntry {
  key: string;
  sourceVar: string | null;
  present: boolean;
  literal: boolean;
}

interface ServerEntry {
  name: string;
  type: string;
  command: string | null;
  args: string[];
  url: string | null;
  envVars: EnvVarEntry[];
  status: 'ready' | 'needs-env';
  missing: string[];
}

export function McpConfigButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="credentials__trigger" onClick={onClick} title="MCP Config">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    </button>
  );
}

type AddState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string; commit?: string | null };

export function McpConfig({ onClose }: { onClose: () => void }) {
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [configPath, setConfigPath] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addSpec, setAddSpec] = useState('{\n  "command": "npx",\n  "args": ["-y", "<package>"],\n  "env": {}\n}');
  const [addState, setAddState] = useState<AddState>({ status: 'idle' });
  const [removing, setRemoving] = useState<Record<string, AddState>>({});

  async function load() {
    try {
      const r = await fetch('/api/mcp/list');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'load failed');
      setServers(j.servers || []);
      setConfigPath(j.configPath || '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, []);

  async function handleAdd() {
    if (!addName.trim()) {
      setAddState({ status: 'error', message: 'name is required' });
      return;
    }
    let parsedSpec: unknown;
    try { parsedSpec = JSON.parse(addSpec); }
    catch (e) {
      setAddState({ status: 'error', message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    setAddState({ status: 'saving' });
    try {
      const r = await fetch('/api/mcp/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), spec: parsedSpec }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'add failed');
      setAddState({ status: 'saved', commit: j.commit });
      setAddName('');
      setAddOpen(false);
      await load();
    } catch (err) {
      setAddState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleRemove(name: string) {
    if (!window.confirm(`Remove MCP '${name}' from .mcp.json? This commits + pushes to origin.`)) return;
    setRemoving(p => ({ ...p, [name]: { status: 'saving' } }));
    try {
      const r = await fetch(`/api/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'remove failed');
      setRemoving(p => ({ ...p, [name]: { status: 'saved', commit: j.commit } }));
      await load();
    } catch (err) {
      setRemoving(p => ({ ...p, [name]: { status: 'error', message: err instanceof Error ? err.message : String(err) } }));
    }
  }

  const ready = servers.filter(s => s.status === 'ready').length;

  return (
    <div className="credentials__overlay" onClick={onClose}>
      <div className="credentials__box" onClick={e => e.stopPropagation()}>
        <div className="credentials__header">
          <span className="credentials__title">
            MCP Servers
            <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)' }}>
              {ready}/{servers.length} ready
            </span>
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="credentials__close"
              style={{ fontSize: 11, padding: '2px 10px', border: '1px solid var(--color-border)', borderRadius: 4 }}
              onClick={() => { setAddState({ status: 'idle' }); setAddOpen(v => !v); }}
              title={addOpen ? 'Cancel' : 'Add a new MCP server'}
            >{addOpen ? 'cancel' : '+ add'}</button>
            <button className="credentials__close" onClick={onClose}>&times;</button>
          </div>
        </div>

        {addOpen && (
          <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)' }}>Name</label>
              <input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="my-mcp"
                style={{ background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '4px 8px', fontFamily: 'var(--font-family-mono)', fontSize: 12, borderRadius: 3 }}
                autoFocus
              />
              <label style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)', marginTop: 4 }}>Spec (JSON: {`{"command","args","env"}`} for stdio, or {`{"type":"http","url"}`} for HTTP)</label>
              <textarea
                value={addSpec}
                onChange={e => setAddSpec(e.target.value)}
                rows={7}
                spellCheck={false}
                style={{ background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '6px 8px', fontFamily: 'var(--font-family-mono)', fontSize: 11, borderRadius: 3, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <button
                  onClick={handleAdd}
                  disabled={addState.status === 'saving'}
                  style={{ background: 'var(--color-accent)', color: 'var(--color-bg)', border: 'none', padding: '4px 14px', borderRadius: 3, fontSize: 12, cursor: addState.status === 'saving' ? 'wait' : 'pointer', fontFamily: 'var(--font-family-mono)' }}
                >{addState.status === 'saving' ? 'saving…' : 'save + commit + push'}</button>
                {addState.status === 'error' && (
                  <span style={{ fontSize: 10, color: 'oklch(0.68 0.22 25)', fontFamily: 'var(--font-family-mono)' }}>{addState.message}</span>
                )}
                {addState.status === 'saved' && addState.commit && (
                  <span style={{ fontSize: 10, color: 'var(--color-accent)', fontFamily: 'var(--font-family-mono)' }}>✓ saved · {addState.commit.slice(0, 7)}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: '10px 16px', color: 'oklch(0.68 0.22 25)', fontFamily: 'var(--font-family-mono)', fontSize: 11 }}>
            {error}
          </div>
        )}

        <div className="credentials__list">
          {servers.length === 0 && !error && (
            <div className="credentials__group">
              <div style={{ padding: 12, fontSize: 11, color: 'var(--color-text-muted)' }}>loading…</div>
            </div>
          )}

          {servers.map(s => {
            const isOpen = expanded[s.name] ?? (s.status !== 'ready');
            return (
              <div key={s.name} className="credentials__entry" style={{ marginBottom: 6 }}>
                <div className="credentials__entry-head"
                     onClick={() => setExpanded(p => ({ ...p, [s.name]: !isOpen }))}
                     style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div className="credentials__entry-title">
                    <span
                      className={`credentials__entry-status credentials__entry-status--${s.status === 'ready' ? 'complete' : 'partial'}`}
                      title={s.status === 'ready' ? 'All env vars set' : `Missing: ${s.missing.join(', ')}`}
                    />
                    <span className="credentials__key-name">{s.name}</span>
                    <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)' }}>
                      {s.type}
                    </span>
                  </div>
                  <div className="credentials__entry-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)' }}>
                      {removing[s.name]?.status === 'saving' ? 'removing…' :
                       removing[s.name]?.status === 'error' ? `× ${removing[s.name].message}` :
                       s.status === 'ready' ? '✓ ready' : `⚠ ${s.missing.length} missing`}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemove(s.name); }}
                      disabled={removing[s.name]?.status === 'saving'}
                      title={`Remove '${s.name}' from .mcp.json (commits + pushes)`}
                      style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 3, padding: '1px 7px', fontSize: 11, cursor: removing[s.name]?.status === 'saving' ? 'wait' : 'pointer', fontFamily: 'var(--font-family-mono)' }}
                    >×</button>
                  </div>
                </div>

                {isOpen && (
                  <>
                    {(s.command || s.url) && (
                      <div className="credentials__scope" style={{ fontFamily: 'var(--font-family-mono)', fontSize: 10 }}>
                        <span className="credentials__scope-label">{s.url ? 'URL:' : 'Command:'}</span>{' '}
                        {s.url ? s.url : `${s.command} ${s.args.join(' ')}`}
                      </div>
                    )}

                    {s.envVars.length > 0 && (
                      <div style={{ padding: '4px 16px 8px' }}>
                        {s.envVars.map(v => (
                          <div key={v.key} className="credentials__field">
                            <div className="credentials__row-info">
                              <span className={`credentials__dot credentials__dot--${v.present ? 'set' : 'unset'}`} />
                              <span className="credentials__field-label">{v.key}</span>
                              {v.sourceVar && (
                                <span className="credentials__env-var">{v.sourceVar}</span>
                              )}
                              {v.literal && (
                                <span className="credentials__env-var" style={{ opacity: 0.6 }}>literal</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {s.envVars.length === 0 && (
                      <div className="credentials__scope" style={{ fontSize: 10, opacity: 0.7 }}>
                        No env vars required.
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="credentials__footer">
          Source of truth: <code style={{ fontFamily: 'var(--font-family-mono)' }}>{configPath || '.mcp.json'}</code>.
          Add/remove writes <code>.mcp.json</code>, commits, and pushes to origin.
          Changes take effect on the next engine turn — every chat spawns a fresh CLI that re-reads the file.
        </div>
      </div>
    </div>
  );
}
