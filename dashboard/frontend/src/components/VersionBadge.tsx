import { useEffect, useState } from 'react';

type Version = {
  commit: string | null;
  commitTime: string | null;
  pulledAt: string | null;
  dirty?: boolean;
  editedAt?: string | null;
};

function formatDateHour(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchVersion(): Promise<Version | null> {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) return null;
    return (await res.json()) as Version;
  } catch {
    return null;
  }
}

export function VersionBadge() {
  const [loaded, setLoaded] = useState<Version | null>(null);
  const [current, setCurrent] = useState<Version | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVersion().then(v => {
      if (cancelled || !v) return;
      setLoaded(v);
      setCurrent(v);
    });
    // Poll faster so the badge picks up working-tree edits soon after they
    // happen. Server caches at 5s, so this is bounded on the bridge side.
    const id = window.setInterval(async () => {
      const v = await fetchVersion();
      if (cancelled || !v) return;
      setCurrent(v);
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!loaded || !loaded.commit) return null;

  const stale = !!(current && current.commit && current.commit !== loaded.commit);
  const createdAt = formatDateHour(loaded.commitTime || loaded.pulledAt);
  const tooltip = [
    `commit ${loaded.commit}`,
    loaded.commitTime ? `committed ${loaded.commitTime}` : '',
    loaded.pulledAt ? `pulled ${loaded.pulledAt}` : '',
    stale && current?.commit ? `\nupdate available: ${current.commit} — click Reload` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <>
      <span className="wm-taskbar__version" title={tooltip}>
        {loaded.commit}
        {createdAt ? ` - ${createdAt}` : ''}
      </span>
      {stale && (
        <button
          className="wm-taskbar__reload"
          onClick={() => window.location.reload()}
          title={`Reload to apply ${current?.commit ?? 'new version'}`}
        >
          Reload
        </button>
      )}
    </>
  );
}
