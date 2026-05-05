import { useMemo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDashboard } from '../store';
import type { Document } from '../types/dashboard';

// Languages that are safely text-editable in the inline editor.
const EDITABLE_LANGUAGES = new Set([
  'markdown', 'html', 'json', 'svg', 'typescript', 'javascript',
  'tsx', 'jsx', 'css', 'sql', 'python', 'yaml', 'text', 'plaintext',
]);
function isEditable(doc: Document): boolean {
  return EDITABLE_LANGUAGES.has(doc.language) || doc.language === 'unknown';
}

function CodeView({ doc }: { doc: Document }) {
  const lines = doc.content.split('\n');
  return (
    <div className="doc-preview__code">
      {lines.map((line, i) => (
        <div key={i} className="doc-preview__code-line">
          <span className="doc-preview__line-no">{i + 1}</span>
          <span>{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function MarkdownView({ doc }: { doc: Document }) {
  return (
    <div className="doc-preview__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return <code {...props}>{children}</code>;
            }
            return <pre><code className={className} {...props}>{children}</code></pre>;
          },
          a({ href, children, ...props }) {
            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
          },
        }}
      >
        {doc.content}
      </ReactMarkdown>
    </div>
  );
}

function HtmlView({ doc }: { doc: Document }) {
  const srcDoc = useMemo(() => {
    // Wrap in a basic document with white background
    if (doc.content.includes('<html') || doc.content.includes('<!DOCTYPE')) {
      return doc.content;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:16px;font-family:system-ui,sans-serif;}</style></head><body>${doc.content}</body></html>`;
  }, [doc.content]);

  return (
    <iframe
      className="doc-preview__html-frame"
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title={doc.filename}
    />
  );
}

function JsonView({ doc }: { doc: Document }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(doc.content), null, 2);
    } catch {
      return doc.content;
    }
  }, [doc.content]);

  return (
    <div className="doc-preview__code">
      {formatted.split('\n').map((line, i) => (
        <div key={i} className="doc-preview__code-line">
          <span className="doc-preview__line-no">{i + 1}</span>
          <span>{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function SvgView({ doc }: { doc: Document }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', padding: 16, background: 'oklch(0.95 0 0)', borderRadius: 4,
      }}
      dangerouslySetInnerHTML={{ __html: doc.content }}
    />
  );
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function BinaryView({ doc }: { doc: Document }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, gap: 8 }}>
      <div style={{ fontSize: 44, opacity: 0.5 }}>📄</div>
      <div style={{ fontWeight: 600 }}>{doc.filename}</div>
      <div style={{ opacity: 0.6, fontSize: 12 }}>{doc.language.toUpperCase()}{doc.size ? ` · ${formatBytes(doc.size)}` : ''}</div>
      <div style={{ opacity: 0.5, fontSize: 11, marginTop: 8, textAlign: 'center', maxWidth: 320 }}>
        Binary file — no inline preview. {doc.driveUrl ? <>Open in <a href={doc.driveUrl} target="_blank" rel="noopener noreferrer">Drive</a>.</> : 'Syncing to Drive…'}
      </div>
    </div>
  );
}

function DocContent({ doc }: { doc: Document }) {
  switch (doc.language) {
    case 'markdown':
      return <MarkdownView doc={doc} />;
    case 'html':
      return <HtmlView doc={doc} />;
    case 'json':
      return <JsonView doc={doc} />;
    case 'svg':
      return <SvgView doc={doc} />;
    case 'image':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <img src={doc.content.startsWith('data:') ? doc.content : doc.path} alt={doc.filename} style={{ maxWidth: '100%', maxHeight: '100%' }} />
        </div>
      );
    case 'binary':
      return <BinaryView doc={doc} />;
    default:
      return <CodeView doc={doc} />;
  }
}

interface DocumentPreviewProps {
  docs?: Document[];
  emptyMessage?: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function DocumentPreview({ docs: docsProp, emptyMessage }: DocumentPreviewProps = {}) {
  const { documents, activeDocumentId, setActiveDocument } = useDashboard();
  const documentsToRender = docsProp ?? documents;
  const activeDoc = documentsToRender.find(d => d.id === activeDocumentId) || documentsToRender[0];

  // Per-document editor buffer keyed by doc.id so switching tabs preserves
  // unsaved edits. Reset when the underlying doc.content changes from upstream.
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string>('');

  const isActiveEditing = activeDoc ? !!editing[activeDoc.id] : false;
  const draft = activeDoc ? (drafts[activeDoc.id] ?? activeDoc.content) : '';
  const dirty = activeDoc ? draft !== activeDoc.content : false;

  // Drop drafts when the upstream content changes (e.g., an engine rewrites the file).
  useEffect(() => {
    if (!activeDoc) return;
    setDrafts(d => {
      if (d[activeDoc.id] === undefined) return d;
      // If user hasn't changed it, sync to new upstream content; otherwise keep the draft.
      if (d[activeDoc.id] === activeDoc.content) return d;
      return d;
    });
  }, [activeDoc?.content, activeDoc?.id]);

  async function save() {
    if (!activeDoc) return;
    setSaveStatus('saving'); setSaveError('');
    try {
      const r = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeDoc.path, content: draft }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
      // Keep the editor open and the draft in sync — upstream watcher will refresh doc.content
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  if (documentsToRender.length === 0) {
    return (
      <div className="doc-preview">
        <div className="doc-preview__empty">
          {emptyMessage ?? 'documents will appear here as the active engine creates files'}
        </div>
      </div>
    );
  }

  const canEdit = activeDoc && isEditable(activeDoc);

  return (
    <div className="doc-preview">
      {/* Tabs for open documents */}
      <div className="doc-preview__tabs">
        {documentsToRender.slice(0, 15).map(doc => (
          <button
            key={doc.id}
            className={`doc-preview__tab ${doc.id === activeDoc.id ? 'doc-preview__tab--active' : ''}`}
            onClick={() => setActiveDocument(doc.id)}
            title={doc.path}
          >
            {doc.filename}{drafts[doc.id] !== undefined && drafts[doc.id] !== doc.content ? ' •' : ''}
            <span className="doc-preview__tab-lang">{doc.language}</span>
          </button>
        ))}
      </div>

      {/* File path bar + edit/save/download */}
      <div className="doc-preview__path">
        <span>{activeDoc.path}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {canEdit && !isActiveEditing && (
            <button
              className="doc-preview__download"
              onClick={() => {
                setDrafts(d => ({ ...d, [activeDoc.id]: activeDoc.content }));
                setEditing(e => ({ ...e, [activeDoc.id]: true }));
              }}
              title="Edit this file"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>edit</span>
            </button>
          )}
          {canEdit && isActiveEditing && (
            <>
              <button
                className="doc-preview__download"
                onClick={save}
                disabled={!dirty || saveStatus === 'saving'}
                title={dirty ? 'Save (Cmd/Ctrl+S)' : 'No changes to save'}
                style={{
                  opacity: dirty ? 1 : 0.4,
                  color: saveStatus === 'saved' ? 'oklch(0.75 0.18 145)' : saveStatus === 'error' ? 'oklch(0.7 0.2 25)' : undefined,
                }}
              >
                <span>
                  {saveStatus === 'saving' ? 'saving…' : saveStatus === 'saved' ? 'saved ✓' : saveStatus === 'error' ? 'failed' : 'save'}
                </span>
              </button>
              <button
                className="doc-preview__download"
                onClick={() => {
                  setEditing(e => ({ ...e, [activeDoc.id]: false }));
                  setDrafts(d => { const copy = { ...d }; delete copy[activeDoc.id]; return copy; });
                  setSaveStatus('idle');
                }}
                title="Discard unsaved changes"
              >
                <span>cancel</span>
              </button>
            </>
          )}
          <button
            className="doc-preview__download"
            onClick={() => {
              const blob = new Blob([isActiveEditing ? draft : activeDoc.content], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = activeDoc.filename;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title={`Download ${activeDoc.filename}`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>download</span>
          </button>
        </div>
      </div>

      {saveStatus === 'error' && (
        <div style={{ padding: '6px 12px', fontSize: 11, color: 'oklch(0.7 0.2 25)', fontFamily: 'var(--font-family-mono)' }}>
          {saveError}
        </div>
      )}

      {/* Content — editor or rendered preview */}
      <div className="doc-preview__content">
        {isActiveEditing ? (
          <textarea
            className="doc-preview__editor"
            value={draft}
            spellCheck={false}
            onChange={e => setDrafts(d => ({ ...d, [activeDoc.id]: e.target.value }))}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                if (dirty) save();
              }
            }}
            style={{
              width: '100%', height: '100%', resize: 'none', border: 'none',
              outline: 'none', padding: '12px 16px', boxSizing: 'border-box',
              background: 'var(--color-bg-inset)', color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-family-mono)', fontSize: 12, lineHeight: 1.55,
              tabSize: 2,
            }}
          />
        ) : (
          <DocContent doc={activeDoc} />
        )}
      </div>
    </div>
  );
}
