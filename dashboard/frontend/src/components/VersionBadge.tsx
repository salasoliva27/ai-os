import { useEffect, useState } from 'react';

type Version = {
  commit: string | null;
  commitTime: string | null;
  pulledAt: string | null;
  dirty?: boolean;
  editedAt?: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
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
  const live = current ?? loaded;
  // Prefer most recent uncommitted edit; otherwise fall back to last pull/commit.
  const reference = live.editedAt || live.pulledAt || live.commitTime;
  const editedSuffix = live.editedAt ? ' · edited' : '';
  const tooltip = [
    `commit ${loaded.commit}`,
    live.editedAt ? `working tree edited ${live.editedAt}` : '',
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
        {reference ? ` · ${relativeTime(reference)}${editedSuffix}` : ''}
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
