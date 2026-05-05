import { useEffect, useState } from 'react';

// Shows a blocking modal on first run when no provider is usable — no API
// keys in env and no OAuth sessions active. Dismisses automatically the
// moment a provider becomes usable (subscription completes, key saved).
// User can also defer with "set up later" which sets a localStorage flag.

const DEFER_KEY = 'janus.onboarding.deferred';

type ProviderSlot = {
  id: 'claude' | 'openai' | 'gemini';
  label: string;
  subscriptionLabel: string | null;   // null = no OAuth path (Gemini)
  subscriptionEndpoint: string | null; // e.g. "claude-auth"
  apiKeyEnvVar: string;
  /** tab id in the Credentials panel to land on when user clicks "use API key" */
  credentialsTabId: string;
};

const SLOTS: ProviderSlot[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    subscriptionLabel: 'Use Claude subscription (Pro / Max)',
    subscriptionEndpoint: 'claude-auth',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    credentialsTabId: 'anthropic',
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    subscriptionLabel: 'Use ChatGPT subscription (Plus / Pro / Team)',
    subscriptionEndpoint: 'codex-auth',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    credentialsTabId: 'openai',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    subscriptionLabel: null, // Gemini CLI OAuth is interactive-only, not suitable here
    subscriptionEndpoint: null,
    apiKeyEnvVar: 'GEMINI_API_KEY',
    credentialsTabId: 'gemini',
  },
];

async function fetchProviderReadiness(): Promise<{
  envKeys: Record<string, boolean>;
  claudeLoggedIn: boolean;
  codexLoggedIn: boolean;
}> {
  // /api/credentials/status (POST, takes a list of env var names) is the
  // canonical env-var presence check in the bridge. Fall back to empty on
  // failure — better to show onboarding than silently hide when the bridge
  // is unreachable.
  const envVars = SLOTS.map(s => s.apiKeyEnvVar);
  const [credRes, claudeRes, codexRes] = await Promise.allSettled([
    fetch('/api/credentials/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars }),
    }).then(r => r.json()),
    fetch('/api/claude-auth/status').then(r => r.json()),
    fetch('/api/codex-auth/status').then(r => r.json()),
  ]);

  const envKeys: Record<string, boolean> = {};
  if (credRes.status === 'fulfilled' && credRes.value?.envVars) {
    for (const v of envVars) {
      envKeys[v] = Boolean(credRes.value.envVars[v]);
    }
  }
  const claudeLoggedIn = claudeRes.status === 'fulfilled'
    && claudeRes.value?.loggedIn
    && claudeRes.value?.authMethod === 'claude.ai'
    && !claudeRes.value?.accessTokenExpired
    && !claudeRes.value?.reauthRequired;
  const codexLoggedIn = codexRes.status === 'fulfilled'
    && codexRes.value?.loggedIn
    && codexRes.value?.authMethod === 'chatgpt';
  return { envKeys, claudeLoggedIn, codexLoggedIn };
}

export function FirstRunOnboarding({ onOpenCredentials }: { onOpenCredentials: (tabId: string) => void }) {
  const [show, setShow] = useState<boolean | null>(null); // null = still checking
  const [pending, setPending] = useState<Record<string, 'idle' | 'starting' | 'awaiting' | 'error'>>({});
  const [authUrls, setAuthUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const checkReadiness = async () => {
    if (localStorage.getItem(DEFER_KEY) === '1') {
      setShow(false);
      return;
    }
    try {
      const { envKeys, claudeLoggedIn, codexLoggedIn } = await fetchProviderReadiness();
      const anyReady = claudeLoggedIn || codexLoggedIn || Object.values(envKeys).some(Boolean);
      setShow(!anyReady);
    } catch {
      // Bridge not reachable — don't block the UI with onboarding when we
      // can't even tell what's configured. Reappears on next page load.
      setShow(false);
    }
  };

  useEffect(() => { checkReadiness(); }, []);

  // Poll every 2s while visible so subscription completions / key saves auto-dismiss.
  useEffect(() => {
    if (show !== true) return;
    const t = window.setInterval(checkReadiness, 2000);
    return () => window.clearInterval(t);
  }, [show]);

  const startSubscription = async (slot: ProviderSlot) => {
    if (!slot.subscriptionEndpoint) return;
    setPending(p => ({ ...p, [slot.id]: 'starting' }));
    setErrors(e => ({ ...e, [slot.id]: '' }));
    try {
      const r = await fetch(`/api/${slot.subscriptionEndpoint}/login`, { method: 'POST' });
      const d = await r.json();
      if (d.loggedIn) {
        setPending(p => ({ ...p, [slot.id]: 'idle' }));
        await checkReadiness();
        return;
      }
      if (!r.ok || (!d.url && !d.opened)) {
        setPending(p => ({ ...p, [slot.id]: 'error' }));
        setErrors(e => ({ ...e, [slot.id]: d.error || 'failed to start login' }));
        return;
      }
      if (d.url) setAuthUrls(u => ({ ...u, [slot.id]: d.url }));
      setPending(p => ({ ...p, [slot.id]: 'awaiting' }));
      if (d.url && slot.subscriptionEndpoint !== 'claude-auth') window.open(d.url, '_blank', 'noopener');
    } catch (err) {
      setPending(p => ({ ...p, [slot.id]: 'error' }));
      setErrors(e => ({ ...e, [slot.id]: String(err) }));
    }
  };

  const deferSetup = () => {
    localStorage.setItem(DEFER_KEY, '1');
    setShow(false);
  };

  if (show !== true) return null;

  return (
    <div className="onboarding__backdrop" role="dialog" aria-modal="true">
      <div className="onboarding__modal">
        <h2 className="onboarding__title">Welcome — pick an engine for the brain</h2>
        <p className="onboarding__subtitle">
          No provider is configured yet. Sign in with a subscription or paste an API key for any of the
          options below. You can add more providers later from the credentials panel.
        </p>
        <div className="onboarding__slots">
          {SLOTS.map(slot => {
            const p = pending[slot.id] || 'idle';
            const url = authUrls[slot.id];
            const err = errors[slot.id];
            return (
              <div key={slot.id} className="onboarding__slot">
                <div className="onboarding__slot-head">{slot.label}</div>
                {slot.subscriptionLabel && (
                  <button
                    className="onboarding__btn onboarding__btn--primary"
                    onClick={() => startSubscription(slot)}
                    disabled={p === 'starting' || p === 'awaiting'}
                  >
                    {p === 'starting' ? 'starting…' : p === 'awaiting' ? 'waiting for browser…' : slot.subscriptionLabel}
                  </button>
                )}
                {p === 'awaiting' && url && (
                  <div className="onboarding__hint">
                    A browser tab opened. If it didn't,{' '}
                    <a href={url} target="_blank" rel="noreferrer noopener">click here ↗</a>
                  </div>
                )}
                {err && <div className="onboarding__error">{err}</div>}
                <button
                  className="onboarding__btn onboarding__btn--secondary"
                  onClick={() => onOpenCredentials(slot.credentialsTabId)}
                >
                  Or paste {slot.apiKeyEnvVar}
                </button>
              </div>
            );
          })}
        </div>
        <div className="onboarding__footer">
          <button className="onboarding__skip" onClick={deferSetup}>
            Skip for now — I'll set this up later
          </button>
        </div>
      </div>
    </div>
  );
}
