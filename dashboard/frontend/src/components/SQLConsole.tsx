import { useEffect, useRef, useState } from 'react';
import { useDashboard } from '../store';

interface SQLConsoleProps {
  tool: 'supabase' | 'snowflake';
}

interface QueryResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  columns?: string[];
  rowCount?: number;
  elapsed?: number;
  error?: unknown;
}

interface HistoryEntry {
  query: string;
  result: QueryResult;
  timestamp: number;
}

const STARTER_QUERIES: Record<SQLConsoleProps['tool'], string[]> = {
  supabase: [
    'SELECT current_database(), current_user, version();',
  ],
  snowflake: [
    'SELECT CURRENT_ACCOUNT(), CURRENT_USER(), CURRENT_WAREHOUSE(), CURRENT_DATABASE();',
  ],
};

const HISTORY_KEY_PREFIX = 'sql-console-history-';

function loadHistory(tool: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + tool);
    return raw ? JSON.parse(raw) as HistoryEntry[] : [];
  } catch { return []; }
}

function saveHistory(tool: string, history: HistoryEntry[]) {
  try {
    // Keep last 30 entries
    const trimmed = history.slice(0, 30);
    localStorage.setItem(HISTORY_KEY_PREFIX + tool, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

function formatCell(v: unknown): string {
  if (v === null) return 'NULL';
  if (v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// RFC 4180-ish CSV: wrap cells containing quote, comma, or newline in quotes
// and double any inner quotes. Null/undefined become empty strings.
function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const head = columns.map(toCsvCell).join(',');
  const body = rows.map(r => columns.map(c => toCsvCell(r[c])).join(',')).join('\n');
  return head + '\n' + body + (body ? '\n' : '');
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SQLConsole({ tool }: SQLConsoleProps) {
  const { sendChatMessage } = useDashboard();
  const [query, setQuery] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory(tool));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handOffToChat() {
    if (!result || result.ok) return;
    const errText = typeof result.error === 'string'
      ? result.error
      : JSON.stringify(result.error, null, 2);
    const msg = [
      `I ran a query in the ${tool === 'supabase' ? 'Supabase' : 'Snowflake'} console and it errored. Can you fix it?`,
      '',
      'Query:',
      '```sql',
      query.trim() || history[0]?.query || '',
      '```',
      '',
      'Error:',
      '```',
      errText,
      '```',
    ].join('\n');
    sendChatMessage(msg);
    setHandedOff(true);
    setTimeout(() => setHandedOff(false), 2500);
  }

  useEffect(() => {
    // Focus on mount
    textareaRef.current?.focus();
  }, []);

  async function runQuery() {
    const q = query.trim();
    if (!q || running) return;
    setRunning(true);
    setResult(null);
    try {
      const resp = await fetch('/api/sql/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, query: q }),
      });
      const data = await resp.json() as QueryResult;
      setResult(data);
      const entry: HistoryEntry = { query: q, result: data, timestamp: Date.now() };
      const next = [entry, ...history];
      setHistory(next);
      saveHistory(tool, next);
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setRunning(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }

  function useStarter(q: string) {
    setQuery(q);
    textareaRef.current?.focus();
  }

  function restoreFromHistory(entry: HistoryEntry) {
    setQuery(entry.query);
    setResult(entry.result);
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }

  function clearHistory() {
    setHistory([]);
    saveHistory(tool, []);
  }

  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];
  const canDownload = !!result?.ok && rows.length > 0 && columns.length > 0;

  function downloadCsv() {
    if (!canDownload) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(rowsToCsv(columns, rows), `${tool}-${stamp}.csv`, 'text/csv;charset=utf-8');
  }
  function downloadJson() {
    if (!canDownload) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(JSON.stringify(rows, null, 2), `${tool}-${stamp}.json`, 'application/json');
  }

  return (
    <div className="sql-console">
      <div className="sql-console__toolbar">
        <span className="sql-console__label">
          <span className={`sql-console__dot sql-console__dot--${tool}`} />
          {tool === 'supabase' ? 'Supabase' : 'Snowflake'} SQL
        </span>
        <button
          className="sql-console__btn"
          onClick={runQuery}
          disabled={!query.trim() || running}
          title="Ctrl/Cmd + Enter"
        >
          {running ? 'running…' : '▶ execute'}
        </button>
        <button
          className="sql-console__btn sql-console__btn--ghost"
          onClick={() => setHistoryOpen(v => !v)}
        >
          history ({history.length})
        </button>
        <div className="sql-console__spacer" />
        {result?.elapsed != null && (
          <span className="sql-console__meta">{result.elapsed}ms</span>
        )}
        {result?.ok && result.rowCount != null && (
          <span className="sql-console__meta">{result.rowCount} row{result.rowCount === 1 ? '' : 's'}</span>
        )}
        {canDownload && (
          <>
            <button
              className="sql-console__btn sql-console__btn--ghost"
              onClick={downloadCsv}
              title="Download result as CSV"
            >
              ↓ CSV
            </button>
            <button
              className="sql-console__btn sql-console__btn--ghost"
              onClick={downloadJson}
              title="Download result as JSON"
            >
              ↓ JSON
            </button>
          </>
        )}
      </div>

      <div className="sql-console__editor-wrap">
        <textarea
          ref={textareaRef}
          className="sql-console__editor"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`-- ${tool === 'supabase' ? 'Supabase' : 'Snowflake'} SQL. Ctrl/Cmd+Enter to run.\n-- Try a starter query below or write your own.`}
          spellCheck={false}
        />
        {query.trim() === '' && (
          <div className="sql-console__starters">
            {STARTER_QUERIES[tool].map((q, i) => (
              <button key={i} className="sql-console__starter" onClick={() => useStarter(q)}>
                {q.length > 60 ? q.slice(0, 57) + '…' : q}
              </button>
            ))}
          </div>
        )}
      </div>

      {historyOpen && (
        <div className="sql-console__history">
          <div className="sql-console__history-header">
            <span>query history</span>
            <button className="sql-console__btn sql-console__btn--ghost" onClick={clearHistory}>clear</button>
          </div>
          {history.length === 0 && (
            <div className="sql-console__empty">no queries yet</div>
          )}
          {history.map((h, i) => (
            <div key={i} className="sql-console__history-item" onClick={() => restoreFromHistory(h)}>
              <span className={`sql-console__history-status sql-console__history-status--${h.result.ok ? 'ok' : 'err'}`} />
              <span className="sql-console__history-query">{h.query.length > 80 ? h.query.slice(0, 77) + '…' : h.query}</span>
              <span className="sql-console__history-meta">
                {h.result.ok ? `${h.result.rowCount ?? 0} rows` : 'error'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="sql-console__results">
        {result == null && !running && (
          <div className="sql-console__empty">no results yet — write a query and hit execute</div>
        )}
        {running && (
          <div className="sql-console__empty">running…</div>
        )}
        {result && !result.ok && (
          <div className="sql-console__error-wrap">
            <pre className="sql-console__error">
              {typeof result.error === 'string' ? result.error : JSON.stringify(result.error, null, 2)}
            </pre>
            <button
              className="sql-console__ask-claude"
              onClick={handOffToChat}
              title="Send query + error to chat"
              disabled={handedOff}
            >
              {handedOff ? '✓ sent to chat' : '→ ask engine to fix'}
            </button>
          </div>
        )}
        {result?.ok && rows.length === 0 && (
          <div className="sql-console__empty">query ok — 0 rows returned</div>
        )}
        {result?.ok && rows.length > 0 && (
          <div className="sql-console__table-wrap">
            <table className="sql-console__table">
              <thead>
                <tr>
                  {columns.map(c => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {columns.map(c => (
                      <td key={c} title={formatCell(row[c])}>{formatCell(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
