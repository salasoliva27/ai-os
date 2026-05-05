import { useState, useEffect, useCallback, useRef } from 'react';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface OpenFile {
  path: string;
  name: string;
  content: string;
  original: string;
  dirty: boolean;
}

function FileTree({ currentPath, workspaceRoot, onSelect }: { currentPath: string; workspaceRoot: string; onSelect: (path: string, isDir: boolean) => void }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/files?path=${encodeURIComponent(currentPath)}`)
      .then(r => r.json())
      .then(d => setEntries(d.items || []))
      .catch(() => {});
  }, [currentPath]);

  function toggleDir(dir: string) {
    setExpanded(s => {
      const next = new Set(s);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });
  }

  return (
    <div className="file-tree">
      {currentPath !== workspaceRoot && (
        <div
          className="file-tree__item file-tree__item--dir"
          onClick={() => onSelect(currentPath.split('/').slice(0, -1).join('/'), true)}
        >
          ..
        </div>
      )}
      {entries.map(e => (
        <div key={e.path}>
          <div
            className={`file-tree__item ${e.isDir ? 'file-tree__item--dir' : ''}`}
            onClick={() => e.isDir ? toggleDir(e.path) : onSelect(e.path, false)}
          >
            <span className="file-tree__icon">{e.isDir ? (expanded.has(e.path) ? 'v' : '>') : ' '}</span>
            {e.name}
          </div>
          {e.isDir && expanded.has(e.path) && (
            <div style={{ paddingLeft: 12 }}>
              <SubTree path={e.path} onSelect={onSelect} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SubTree({ path, onSelect }: { path: string; onSelect: (p: string, isDir: boolean) => void }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/files?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(d => setEntries(d.items || []))
      .catch(() => {});
  }, [path]);

  return (
    <>
      {entries.map(e => (
        <div key={e.path}>
          <div
            className={`file-tree__item ${e.isDir ? 'file-tree__item--dir' : ''}`}
            onClick={() => e.isDir ? setExpanded(s => { const n = new Set(s); n.has(e.path) ? n.delete(e.path) : n.add(e.path); return n; }) : onSelect(e.path, false)}
          >
            <span className="file-tree__icon">{e.isDir ? (expanded.has(e.path) ? 'v' : '>') : ' '}</span>
            {e.name}
          </div>
          {e.isDir && expanded.has(e.path) && (
            <div style={{ paddingLeft: 12 }}>
              <SubTree path={e.path} onSelect={onSelect} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function FileEditor() {
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [treePath, setTreePath] = useState<string>('');
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(d => {
        if (d.root) {
          setWorkspaceRoot(d.root);
          setTreePath(prev => prev || d.root);
        }
      })
      .catch(() => {});
  }, []);

  const currentFile = openFiles.find(f => f.path === activeFile);

  const openFile = useCallback((filePath: string) => {
    // Already open?
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveFile(filePath);
      return;
    }

    fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return;
        const file: OpenFile = {
          path: d.path,
          name: d.path.split('/').pop() || d.path,
          content: d.content,
          original: d.content,
          dirty: false,
        };
        setOpenFiles(f => [...f, file]);
        setActiveFile(d.path);
      })
      .catch(() => {});
  }, [openFiles]);

  function handleSelect(path: string, isDir: boolean) {
    if (isDir) {
      setTreePath(path);
    } else {
      openFile(path);
    }
  }

  function updateContent(content: string) {
    setOpenFiles(files => files.map(f =>
      f.path === activeFile ? { ...f, content, dirty: content !== f.original } : f
    ));
  }

  function closeFile(path: string) {
    setOpenFiles(f => f.filter(x => x.path !== path));
    if (activeFile === path) {
      const remaining = openFiles.filter(x => x.path !== path);
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  }

  async function saveFile() {
    if (!currentFile) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFile.path, content: currentFile.content }),
      });
      const data = await res.json();
      if (data.ok) {
        setOpenFiles(files => files.map(f =>
          f.path === currentFile.path ? { ...f, original: f.content, dirty: false } : f
        ));
        setSaveMsg('saved');
        setTimeout(() => setSaveMsg(''), 2000);
      } else {
        setSaveMsg(`error: ${data.error}`);
      }
    } catch (err) {
      setSaveMsg('save failed');
    }
    setSaving(false);
  }

  // Ctrl+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentFile]);

  return (
    <div className="file-editor">
      {/* Sidebar — file tree */}
      <div className="file-editor__sidebar">
        <div className="file-editor__sidebar-header">
          {treePath.split('/').pop()}
        </div>
        <FileTree currentPath={treePath} workspaceRoot={workspaceRoot} onSelect={handleSelect} />
      </div>

      {/* Editor area */}
      <div className="file-editor__main">
        {/* Tabs */}
        {openFiles.length > 0 && (
          <div className="file-editor__tabs">
            {openFiles.map(f => (
              <div
                key={f.path}
                className={`file-editor__tab ${f.path === activeFile ? 'file-editor__tab--active' : ''}`}
                onClick={() => setActiveFile(f.path)}
              >
                <span>{f.dirty ? '* ' : ''}{f.name}</span>
                <button
                  className="file-editor__tab-close"
                  onClick={(e) => { e.stopPropagation(); closeFile(f.path); }}
                >
                  x
                </button>
              </div>
            ))}
            <div className="file-editor__tab-actions">
              {saveMsg && <span className="file-editor__save-msg">{saveMsg}</span>}
              {currentFile?.dirty && (
                <button className="file-editor__save-btn" onClick={saveFile} disabled={saving}>
                  {saving ? 'saving...' : 'Save (Ctrl+S)'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        {currentFile ? (
          <div className="file-editor__content">
            <textarea
              ref={textareaRef}
              className="file-editor__textarea"
              value={currentFile.content}
              onChange={e => updateContent(e.target.value)}
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="file-editor__empty">
            select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}
