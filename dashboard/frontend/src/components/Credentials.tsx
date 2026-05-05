import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../store';

type FieldType = 'password' | 'text';

interface CredentialField {
  id: string;
  label: string;
  envVar: string;
  type: FieldType;
  placeholder?: string;
  /** Direct link to the page where THIS specific field is obtained, if different from the entry's docsUrl. */
  docsUrl?: string;
  /** Tiny per-field hint (one line) — shown next to the field link. */
  hint?: string;
}

interface CredentialEntry {
  id: string;
  provider: string;
  name: string;
  // What this credential lets you do — shown to the user so they know which
  // keys to ask for (e.g. WhatsApp "send" vs "receive").
  scope: string;
  // Direct link to the dashboard/page where this credential is issued.
  docsUrl?: string;
  // Short instruction (one or two sentences) on the path to find each field.
  howTo?: string;
  fields: CredentialField[];
}

const PROVIDERS: { id: string; label: string; color: string }[] = [
  { id: 'anthropic',  label: 'Anthropic',    color: 'oklch(0.72 0.16 40)'  },
  { id: 'supabase',   label: 'Supabase',     color: 'oklch(0.72 0.18 145)' },
  { id: 'snowflake',  label: 'Snowflake',    color: 'oklch(0.75 0.14 210)' },
  { id: 'google',     label: 'Google',       color: 'oklch(0.72 0.16 265)' },
  { id: 'openai',     label: 'OpenAI',       color: 'oklch(0.70 0.15 155)' },
  { id: 'gemini',     label: 'Gemini',       color: 'oklch(0.72 0.14 240)' },
  { id: 'github',     label: 'GitHub',       color: 'oklch(0.70 0.08 280)' },
  { id: 'atlassian',  label: 'Atlassian',    color: 'oklch(0.72 0.18 250)' },
  { id: 'talend',     label: 'Talend',       color: 'oklch(0.70 0.18 30)'  },
  { id: 'search',     label: 'Search',       color: 'oklch(0.70 0.18 85)'  },
  { id: 'whatsapp',   label: 'WhatsApp',     color: 'oklch(0.74 0.16 150)' },
  { id: 'custom',     label: 'Custom',       color: 'oklch(0.65 0.10 220)' },
];

// Each credential declares its own fields — not every value is a "key".
// `scope` makes clear WHAT you can do with these credentials.
const DEFAULT_CREDENTIALS: CredentialEntry[] = [
  {
    id: 'anthropic',
    provider: 'anthropic',
    name: 'Anthropic API',
    scope: 'Read + write — run Claude models (all tiers, all endpoints)',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    howTo: 'Console → Settings → API Keys → Create Key. Copy once — it is not shown again.',
    fields: [
      { id: 'anthropic-key', label: 'API Key', envVar: 'ANTHROPIC_API_KEY', type: 'password', placeholder: 'sk-ant-...' },
    ],
  },
  {
    id: 'supabase-project',
    provider: 'supabase',
    name: 'Supabase Project',
    scope: 'Connect to project (URL + anon key for public reads, service role for full admin)',
    docsUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    howTo: 'Dashboard → pick project → Project Settings → API. URL and both keys are on that page. Service role key bypasses RLS — never ship to a browser.',
    fields: [
      { id: 'supabase-url',          label: 'Project URL',         envVar: 'SUPABASE_URL',                type: 'text',     placeholder: 'https://xxx.supabase.co' },
      { id: 'supabase-anon',         label: 'Anon key',            envVar: 'SUPABASE_ANON_KEY',           type: 'password' },
      { id: 'supabase-key',          label: 'Service role key',    envVar: 'SUPABASE_SERVICE_ROLE_KEY',   type: 'password' },
    ],
  },
  {
    id: 'supabase-mgmt',
    provider: 'supabase',
    name: 'Supabase Management',
    scope: 'Manage projects via the Management API (migrations, edge functions, branches)',
    docsUrl: 'https://supabase.com/dashboard/account/tokens',
    howTo: 'Account → Access Tokens → Generate new token. Project ref is the subdomain of your project URL (e.g. xxx in xxx.supabase.co).',
    fields: [
      { id: 'supabase-access',       label: 'Access token',        envVar: 'SUPABASE_ACCESS_TOKEN',       type: 'password', placeholder: 'sbp_...' },
      { id: 'supabase-project-ref',  label: 'Project ref',         envVar: 'SUPABASE_PROJECT_REF',        type: 'text',     placeholder: 'rycybujjedtofghigyxm' },
    ],
  },
  {
    id: 'snowflake',
    provider: 'snowflake',
    name: 'Snowflake Warehouse',
    scope: 'Query the warehouse (SELECT/INSERT depending on role permissions)',
    docsUrl: 'https://docs.snowflake.com/en/user-guide/admin-account-identifier',
    howTo: 'Account = the identifier in your Snowflake URL (orgname-account). User/password from your Snowflake admin. Warehouse / database / role from your account admin or "SHOW WAREHOUSES" in the worksheet.',
    fields: [
      { id: 'snowflake-account',     label: 'Account',             envVar: 'SNOWFLAKE_ACCOUNT',           type: 'text',
        hint: 'the `orgname-account` segment of your Snowflake URL (e.g. FW64584-REECE from FW64584-REECE.snowflakecomputing.com)' },
      { id: 'snowflake-user',        label: 'User',                envVar: 'SNOWFLAKE_USER',              type: 'text',
        hint: 'your Snowflake login username — ask your admin if unsure' },
      { id: 'snowflake-password',    label: 'Password',            envVar: 'SNOWFLAKE_PASSWORD',          type: 'password',
        hint: 'issued by your Snowflake admin; reset in Snowsight → your name → My profile → Change password' },
      { id: 'snowflake-warehouse',   label: 'Warehouse',           envVar: 'SNOWFLAKE_WAREHOUSE',         type: 'text',
        hint: 'run `SHOW WAREHOUSES` in a worksheet to list available ones' },
      { id: 'snowflake-database',    label: 'Database',            envVar: 'SNOWFLAKE_DATABASE',          type: 'text',
        hint: 'run `SHOW DATABASES` to list; common default is ODS' },
      { id: 'snowflake-role',        label: 'Role',                envVar: 'SNOWFLAKE_ROLE',              type: 'text',
        hint: 'run `SHOW ROLES` or ask your admin which role your user is granted' },
    ],
  },
  {
    id: 'google-calendar',
    provider: 'google',
    name: 'Google (Calendar / Drive / Gmail OAuth)',
    scope: 'Read + write on the connected Google account — scopes the refresh token was minted with (per-user OAuth, not service account)',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    howTo: 'One-time: Cloud Console → APIs & Services → Credentials → OAuth client (Web). Add `https://developers.google.com/oauthplayground` to Authorized redirect URIs. Then mint the refresh token at the Playground with the scopes you need.',
    fields: [
      {
        id: 'google-client-id', label: 'Client ID', envVar: 'GOOGLE_CLIENT_ID', type: 'text',
        placeholder: 'xxx.apps.googleusercontent.com',
        docsUrl: 'https://console.cloud.google.com/apis/credentials',
        hint: 'Cloud Console → APIs & Services → Credentials → your OAuth client',
      },
      {
        id: 'google-client-secret', label: 'Client secret', envVar: 'GOOGLE_CLIENT_SECRET', type: 'password',
        placeholder: 'GOCSPX-...',
        docsUrl: 'https://console.cloud.google.com/apis/credentials',
        hint: 'same OAuth client as the ID above',
      },
      {
        id: 'google-refresh-token', label: 'Refresh token', envVar: 'GOOGLE_REFRESH_TOKEN', type: 'password',
        placeholder: '1//0g...',
        docsUrl: 'https://developers.google.com/oauthplayground/',
        hint: 'OAuth Playground → gear → use own creds → scope → Authorize → Exchange',
      },
    ],
  },
  {
    id: 'openai',
    provider: 'openai',
    name: 'OpenAI API',
    scope: 'Call OpenAI models (chat, embeddings, images — whatever the key allows). Or sign in with your ChatGPT subscription below.',
    docsUrl: 'https://platform.openai.com/api-keys',
    howTo: 'Platform → API keys → Create new secret key. Pick a project; key is shown once.',
    fields: [
      { id: 'openai-key',            label: 'API Key',             envVar: 'OPENAI_API_KEY',              type: 'password', placeholder: 'sk-...' },
    ],
  },
  {
    id: 'gemini',
    provider: 'gemini',
    name: 'Google Gemini API',
    scope: 'Call Gemini models via the Gemini CLI (gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash).',
    docsUrl: 'https://aistudio.google.com/apikey',
    howTo: 'Google AI Studio → Get API key → Create API key. Free tier available. (Gemini CLI also supports interactive Google account login on first run, but that flow isn\'t headless-friendly — use an API key here for the dashboard.)',
    fields: [
      { id: 'gemini-key',            label: 'API Key',             envVar: 'GEMINI_API_KEY',              type: 'password', placeholder: 'AIza...' },
    ],
  },
  {
    id: 'github',
    provider: 'github',
    name: 'GitHub — Personal',
    scope: 'Personal account repo access — scope depends on the PAT (repo:read, repo:write, workflow, etc.)',
    docsUrl: 'https://github.com/settings/tokens',
    howTo: 'Logged in as your personal account → Settings → Developer settings → Personal access tokens. Prefer fine-grained tokens scoped to specific repos. For full repo + workflow access, classic PAT with "repo" + "workflow" scopes.',
    fields: [
      { id: 'github-token',          label: 'Personal access token', envVar: 'GITHUB_TOKEN',              type: 'password', placeholder: 'ghp_... or github_pat_...' },
    ],
  },
  {
    id: 'github-reece',
    provider: 'github',
    name: 'GitHub — REECE (work)',
    scope: 'Work account repo access (REECE) — used alongside the personal token so both sets of repos appear in the dashboard.',
    docsUrl: 'https://github.com/settings/tokens',
    howTo: 'Sign in to your REECE GitHub account → Settings → Developer settings → Personal access tokens. Use the same scopes as the personal token (repo + workflow for full access).',
    fields: [
      { id: 'github-token-reece',    label: 'REECE access token',    envVar: 'GITHUB_TOKEN_REECE',        type: 'password', placeholder: 'ghp_... or github_pat_...' },
    ],
  },
  {
    id: 'jira',
    provider: 'atlassian',
    name: 'Jira (Atlassian Cloud)',
    scope: 'Read tickets assigned to you, view descriptions + comments, transition status, and add comments — needs all three fields.',
    docsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    howTo: 'Atlassian → Account → Security → Create API token. Email is the address you log into Jira with. Base URL is your tenant — e.g. https://reeceusa.atlassian.net.',
    fields: [
      { id: 'jira-key',    label: 'API token',  envVar: 'JIRA_API_KEY',  type: 'password', placeholder: 'ATATT3x...',
        hint: 'mint at id.atlassian.com → Security → API tokens' },
      { id: 'jira-email',  label: 'Email',      envVar: 'JIRA_EMAIL',    type: 'text',     placeholder: 'you@company.com',
        hint: 'the email you log into Jira with' },
      { id: 'jira-url',    label: 'Base URL',   envVar: 'JIRA_BASE_URL', type: 'text',     placeholder: 'https://your-tenant.atlassian.net',
        hint: 'no trailing slash' },
    ],
  },
  {
    id: 'talend',
    provider: 'talend',
    name: 'Talend (Qlik Talend Cloud)',
    scope: 'List/create/manage TMC tasks, schedules, environments, workspaces.',
    docsUrl: 'https://docs.qlik.com/talend/en-US/cloud-management-console/Content/cloud-management-console/personal-access-tokens.htm',
    howTo: 'Talend Cloud → User profile → Personal Access Tokens → Add token. Region is part of the API endpoint (us-west, eu, etc.).',
    fields: [
      { id: 'talend-key',  label: 'API token',  envVar: 'TALEND_API_KEY',  type: 'password' },
    ],
  },
  {
    id: 'brave',
    provider: 'search',
    name: 'Brave Search',
    scope: 'Web + local search via Brave Search API',
    docsUrl: 'https://api-dashboard.search.brave.com/app/keys',
    howTo: 'Brave Search API dashboard → Subscriptions (free tier: 1 query/sec, 2,000/month) → API Keys → Add API Key.',
    fields: [
      { id: 'brave-key',             label: 'API Key',             envVar: 'BRAVE_API_KEY',               type: 'password' },
    ],
  },
  {
    id: 'firecrawl',
    provider: 'search',
    name: 'Firecrawl',
    scope: 'Crawl + scrape pages into clean markdown',
    docsUrl: 'https://www.firecrawl.dev/app/api-keys',
    howTo: 'Firecrawl app → API Keys → Create API Key. Free tier includes 500 credits.',
    fields: [
      { id: 'firecrawl-key',         label: 'API Key',             envVar: 'FIRECRAWL_API_KEY',           type: 'password', placeholder: 'fc-...' },
    ],
  },
  {
    id: 'whatsapp-receive',
    provider: 'whatsapp',
    name: 'WhatsApp — Receive',
    scope: 'Receive inbound messages via webhook (webhook verification only)',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks',
    howTo: 'Meta App → WhatsApp → Configuration → Webhooks. The verify token is a string YOU choose (Meta echoes it back during handshake).',
    fields: [
      {
        id: 'wa-verify-token', label: 'Webhook verify token', envVar: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', type: 'password',
        placeholder: 'your chosen token',
        hint: 'you invent this; Meta echoes it back during handshake — no URL to fetch it from',
      },
      {
        id: 'wa-phone-id', label: 'Phone number ID', envVar: 'WHATSAPP_PHONE_NUMBER_ID', type: 'text',
        docsUrl: 'https://developers.facebook.com/apps',
        hint: 'your app → WhatsApp → API Setup',
      },
    ],
  },
  {
    id: 'whatsapp-send',
    provider: 'whatsapp',
    name: 'WhatsApp — Send',
    scope: 'Send outbound messages via Cloud API (requires Meta app + system user token)',
    docsUrl: 'https://business.facebook.com/settings/system-users',
    howTo: 'Each field lives in a different Meta surface — use the per-field links below.',
    fields: [
      {
        id: 'wa-access-token', label: 'System user access token', envVar: 'WHATSAPP_ACCESS_TOKEN', type: 'password',
        placeholder: 'EAAG...',
        docsUrl: 'https://business.facebook.com/settings/system-users',
        hint: 'Business Settings → System Users → Add → Generate token (scopes: whatsapp_business_messaging + _management)',
      },
      {
        id: 'wa-app-id', label: 'Meta App ID', envVar: 'WHATSAPP_APP_ID', type: 'text',
        docsUrl: 'https://developers.facebook.com/apps',
        hint: 'pick your app — the App ID is shown in the header',
      },
      {
        id: 'wa-business-id', label: 'Business account ID', envVar: 'WHATSAPP_BUSINESS_ACCOUNT_ID', type: 'text',
        docsUrl: 'https://business.facebook.com/settings/info',
        hint: 'Business Settings → Business Info → Business account ID',
      },
    ],
  },
];

type SubscriptionAuthStatus = {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  apiKeySource?: string;
  email?: string | null;
  subscriptionType?: string | null;
  envKeySet?: boolean;
  expiresAt?: number;
  accessTokenExpired?: boolean;
  usableForChat?: boolean;
  reauthRequired?: boolean;
  authProbeReason?: string;
  oauthUnavailableReason?: string;
  error?: string;
};

type SubscriptionPanelProps = {
  /** REST prefix under /api, e.g. "claude-auth" or "codex-auth" */
  endpoint: string;
  /** Heading shown above the button */
  title: string;
  /** Value of status.authMethod that means "subscription auth is live" */
  subscriptionAuthMethod: string;
  /** Bottom-line help text shown when nothing is in flight */
  idleHint: React.ReactNode;
  /** Env var kept as fallback when subscription auth is not usable. */
  apiFallbackEnvVar?: string | null;
};

function SubscriptionPanel({ endpoint, title, subscriptionAuthMethod, idleHint, apiFallbackEnvVar }: SubscriptionPanelProps) {
  const [status, setStatus] = useState<SubscriptionAuthStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'awaiting' | 'error'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  function notifyCredentialsChanged() {
    window.dispatchEvent(new CustomEvent('venture-os:credentials-changed', { detail: { endpoint } }));
  }

  const refresh = async () => {
    try {
      const r = await fetch(`/api/${endpoint}/status`);
      const d = await r.json();
      setStatus(d);
      if (d?.loggedIn && d.authMethod === subscriptionAuthMethod && !d.accessTokenExpired && !d.reauthRequired) {
        notifyCredentialsChanged();
      }
      return d as SubscriptionAuthStatus;
    } catch {
      return null;
    }
  };

  useEffect(() => { refresh(); }, []);

  // Poll while waiting for the OAuth callback to land.
  useEffect(() => {
    if (phase !== 'awaiting') return;
    const t = window.setInterval(async () => {
      const d = await refresh();
      // Exit awaiting as soon as claude auth status confirms the OAuth token is
      // valid. Don't gate on reauthRequired — the subscription probe can briefly
      // 401 right after a fresh OAuth callback before the API accepts the new
      // token. The idle state handles the reauthRequired warning separately.
      if (d?.loggedIn && d.authMethod === subscriptionAuthMethod && !d.accessTokenExpired) {
        setPhase('idle');
        setUrl(null);
        notifyCredentialsChanged();
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [phase, subscriptionAuthMethod]);

  const startLogin = async (force = false) => {
    if (status?.oauthUnavailableReason) {
      setPhase('error');
      setErrMsg(status.oauthUnavailableReason);
      return;
    }
    setPhase('starting');
    setErrMsg(null);
    try {
      const r = await fetch(`/api/${endpoint}/login${force ? '?force=1' : ''}`, { method: 'POST' });
      const d = await r.json();
      if (d.status) setStatus(d.status);
      if (d.loggedIn) {
        if (!d.status) await refresh();
        notifyCredentialsChanged();
        setPhase('idle');
        setUrl(null);
        return;
      }
      if (!r.ok || (!d.url && !d.opened)) {
        setPhase('error');
        setErrMsg(d.error || 'failed to start login');
        return;
      }
      setUrl(d.url || null);
      setPhase('awaiting');
      if (d.url && endpoint !== 'claude-auth') window.open(d.url, '_blank', 'noopener');
    } catch (e) {
      setPhase('error');
      setErrMsg(String(e));
    }
  };

  const signOut = async () => {
    try {
      await fetch(`/api/${endpoint}/logout`, { method: 'POST' });
    } finally {
      await refresh();
      notifyCredentialsChanged();
      setPhase('idle');
      setUrl(null);
    }
  };

  const signedInSubscription = status?.loggedIn && status?.authMethod === subscriptionAuthMethod;
  const statusLoading = status === null;
  const subscriptionNeedsRefresh = signedInSubscription && (status?.accessTokenExpired || status?.reauthRequired);
  const subActive = signedInSubscription && !subscriptionNeedsRefresh;
  const loginUnavailableReason = status?.oauthUnavailableReason;
  const loginDisabled = statusLoading || phase === 'starting' || phase === 'awaiting' || !!loginUnavailableReason;

  return (
    <div className="credentials__sub-panel">
      <div className="credentials__sub-panel-head">
        <span className="credentials__sub-panel-title">{title}</span>
        {statusLoading ? (
          <button className="credentials__save-btn" disabled>
            checking...
          </button>
        ) : subActive ? (
          <button className="credentials__test-btn credentials__test-btn--pass" onClick={signOut}>
            sign out
          </button>
        ) : subscriptionNeedsRefresh ? (
          <>
            {!loginUnavailableReason && (
              <button className="credentials__save-btn" onClick={() => startLogin(true)} disabled={loginDisabled}>
                {phase === 'starting' ? 'starting…' : phase === 'awaiting' ? 'waiting for browser…' : status?.reauthRequired ? 'reauthorize' : 'refresh login'}
              </button>
            )}
            <button className="credentials__test-btn" onClick={signOut}>
              sign out
            </button>
          </>
        ) : loginUnavailableReason ? (
          <button className="credentials__save-btn" disabled>
            local only
          </button>
        ) : (
          <button
            className="credentials__save-btn"
            onClick={() => startLogin()}
            disabled={loginDisabled}
          >
            {phase === 'starting' ? 'starting…' : phase === 'awaiting' ? 'waiting for browser…' : 'use subscription'}
          </button>
        )}
      </div>
      {subActive && (
        <div className="credentials__sub-panel-line">
          ✓ Signed in
          {status?.email ? <> as <strong>{status.email}</strong></> : null}
          {status?.subscriptionType ? <> · plan: {status.subscriptionType}</> : null}
          {apiFallbackEnvVar && status?.envKeySet && (
            <span className="credentials__sub-panel-warn">
              {' '}— {apiFallbackEnvVar} is saved as fallback. Subscription auth takes precedence.
            </span>
          )}
        </div>
      )}
      {loginUnavailableReason && phase !== 'awaiting' && (
        <div className="credentials__sub-panel-line credentials__sub-panel-warn">
          {loginUnavailableReason}
        </div>
      )}
      {subscriptionNeedsRefresh && phase !== 'awaiting' && (
        <div className="credentials__sub-panel-line">
          {status?.reauthRequired ? 'Claude Code could not use the saved subscription login' : 'Local OAuth token is expired'}
          {status?.email ? <> for <strong>{status.email}</strong></> : null}
          {status?.authProbeReason ? <> — {status.authProbeReason}</> : null}
          {loginUnavailableReason ? '. Refresh it from a local dashboard or local Claude CLI.' : '. Reauthorize to restore subscription chat.'}
        </div>
      )}
      {!subActive && phase === 'awaiting' && (
        <div className="credentials__sub-panel-line">
          {url ? (
            <>
              A browser tab opened. If it didn't,{' '}
              <a href={url} target="_blank" rel="noreferrer noopener" className="credentials__howto-link">
                click here ↗
              </a>{' '}
              to finish signing in. This panel will update automatically.
            </>
          ) : (
            <>Finish the authorization in the browser tab. This panel will update automatically.</>
          )}
        </div>
      )}
      {phase === 'error' && errMsg && (
        <div className="credentials__test-error">{errMsg}</div>
      )}
      {!statusLoading && !subActive && phase === 'idle' && !loginUnavailableReason && (
        <div className="credentials__sub-panel-line credentials__sub-panel-hint">
          {idleHint}
        </div>
      )}
    </div>
  );
}

export function CredentialsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="credentials__trigger" onClick={onClick} title="Credentials">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    </button>
  );
}

type FieldValues = Record<string, string>;
type TestState = { status: 'idle' | 'testing' | 'pass' | 'fail'; message?: string };

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

export function Credentials({ onClose, initialProviderId }: { onClose: () => void; initialProviderId?: string }) {
  const { tools, sendChatMessage } = useDashboard();

  // Per-field input state, keyed by field id.
  const [values, setValues] = useState<FieldValues>({});

  // Track which envVars have been set this session to flip the indicator.
  const [sessionSet, setSessionSet] = useState<Record<string, boolean>>({});

  // Per-entry test state (idle | testing | pass | fail + last message).
  const [tests, setTests] = useState<Record<string, TestState>>({});

  // Per-entry save state (idle | saving | saved | error + last message).
  const [saves, setSaves] = useState<Record<string, SaveState>>({});

  // Custom entries — loaded from the bridge's tools registry on mount, then
  // mutated via /api/tools/register and /api/tools/{id}. Persisted at
  // <WORKSPACE_ROOT>/.dashboard/custom-tools.json so they survive reload.
  const [customEntries, setCustomEntries] = useState<CredentialEntry[]>([]);
  const [customName, setCustomName] = useState('');
  const [customEnv, setCustomEnv] = useState('');
  const [customScope, setCustomScope] = useState('');
  const [customMcpName, setCustomMcpName] = useState('');
  const [customMcpSpec, setCustomMcpSpec] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [customSaving, setCustomSaving] = useState(false);

  // Load persisted custom tools on mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tools/list')
      .then(r => r.json())
      .then(j => {
        if (cancelled || !j?.ok || !Array.isArray(j.entries)) return;
        const loaded: CredentialEntry[] = j.entries.map((e: {
          id: string;
          name: string;
          scope?: string;
          docsUrl?: string;
          fields: Array<{ id: string; label: string; envVar: string; type: 'password' | 'text'; placeholder?: string }>;
        }) => ({
          id: e.id,
          provider: 'custom',
          name: e.name,
          scope: e.scope || 'Custom credential',
          docsUrl: e.docsUrl,
          fields: (e.fields || []).map(f => ({
            id: f.id,
            label: f.label,
            envVar: f.envVar,
            type: f.type === 'text' ? 'text' : 'password',
            placeholder: f.placeholder,
          })),
        }));
        setCustomEntries(loaded);
      })
      .catch(() => { /* bridge unreachable — start with empty list */ });
    return () => { cancelled = true; };
  }, []);

  const allEntries = useMemo(() => [...DEFAULT_CREDENTIALS, ...customEntries], [customEntries]);

  // Source-of-truth for "is this field set?" — the bridge reports which env
  // vars are present in its process.env (dotfiles + Codespace secrets, merged).
  // The static `tools` array has stale `configured` flags and doesn't include
  // every field we care about, so we query the bridge directly.
  const [envPresence, setEnvPresence] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const envVars = Array.from(new Set(allEntries.flatMap(e => e.fields.map(f => f.envVar))));
    if (envVars.length === 0) return;
    let cancelled = false;
    fetch('/api/credentials/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars }),
    })
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.ok) setEnvPresence(j.envVars || {}); })
      .catch(() => { /* bridge unreachable — fall back to tools registry */ });
    return () => { cancelled = true; };
  }, [allEntries]);

  function isFieldSet(envVar: string) {
    if (sessionSet[envVar]) return true;
    if (envPresence[envVar]) return true;
    const tool = tools.find(t => t.envVar === envVar);
    return tool ? tool.configured === 'ready' : false;
  }

  // Default-collapsed for everyone. The onboarding flow can still target a
  // specific provider via initialProviderId — that one opens, everything else
  // stays closed. Without an initial provider, the modal opens cleanly with
  // a list of provider headers and the user expands what they want.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const p of PROVIDERS) {
      out[p.id] = !!initialProviderId && p.id === initialProviderId;
    }
    return out;
  });

  function toggle(providerId: string) {
    setExpanded(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  }

  async function handleSaveEntry(entry: CredentialEntry) {
    const filled = entry.fields.filter(f => (values[f.id] || '').trim());
    if (filled.length === 0) return;
    const payload = filled.map(f => ({ envVar: f.envVar, value: (values[f.id] || '').trim() }));
    setSaves(prev => ({ ...prev, [entry.id]: { status: 'saving' } }));
    try {
      const resp = await fetch('/api/credentials/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: payload }),
      });
      const data = await resp.json() as {
        ok: boolean;
        saved?: string[];
        staged?: string[];
        verified?: string[];
        missing?: string[];
        commit?: string | null;
        committed?: boolean;
        pushed?: boolean;
        commitOutput?: string;
        pushOutput?: string;
        target?: string;
        mode?: 'dotfiles' | 'repo-local';
        error?: string;
      };
      if (data.ok) {
        const savedNames = (data.saved || []).join(', ');
        const message = data.mode === 'repo-local'
          ? `Saved ${savedNames} · written to repo .env (gitignored, not committed)`
          : `Saved ${savedNames} · committed ${data.commit ? data.commit.slice(0, 7) : ''} · pushed to dotfiles`;
        setSaves(prev => ({
          ...prev,
          [entry.id]: { status: 'saved', message },
        }));
        setSessionSet(prev => {
          const next = { ...prev };
          for (const f of filled) next[f.envVar] = true;
          return next;
        });
        setValues(prev => {
          const next = { ...prev };
          for (const f of filled) delete next[f.id];
          return next;
        });
        return;
      }
      // Partial / failed: tell the user exactly what happened and what to fix.
      const parts: string[] = [];
      if (data.staged?.length) parts.push(`Staged locally: ${data.staged.join(', ')}`);
      if (!data.committed) parts.push(`Commit failed: ${(data.commitOutput || '').trim().split('\n').pop() || 'unknown'}`);
      else if (!data.pushed) parts.push(`Push failed: ${(data.pushOutput || '').trim().split('\n').pop() || 'unknown'}`);
      if (data.missing?.length) parts.push(`Missing from file: ${data.missing.join(', ')}`);
      if (data.error) parts.push(data.error);
      const msg = parts.join(' · ') || 'Save did not complete';
      setSaves(prev => ({ ...prev, [entry.id]: { status: 'error', message: msg } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaves(prev => ({ ...prev, [entry.id]: { status: 'error', message: `Bridge unreachable: ${msg}` } }));
    }
  }

  async function handleTestEntry(entry: CredentialEntry) {
    // Build a fields map from anything the user typed this turn. Empty values
    // are omitted — the bridge falls back to process.env for those.
    const fieldPayload: Record<string, string> = {};
    for (const f of entry.fields) {
      const v = (values[f.id] || '').trim();
      if (v) fieldPayload[f.envVar] = v;
    }
    setTests(prev => ({ ...prev, [entry.id]: { status: 'testing' } }));
    try {
      const resp = await fetch('/api/credentials/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, fields: fieldPayload }),
      });
      const data = await resp.json() as {
        ok: boolean; message?: string; error?: string; status?: number; details?: string;
      };
      if (data.ok) {
        setTests(prev => ({ ...prev, [entry.id]: { status: 'pass', message: data.message || 'OK' } }));
        return;
      }
      const errLine = data.error || 'Test failed';
      const statusPart = data.status ? ` (HTTP ${data.status})` : '';
      const detailsPart = data.details ? `\n\nResponse body:\n\`\`\`\n${data.details}\n\`\`\`` : '';
      setTests(prev => ({ ...prev, [entry.id]: { status: 'fail', message: errLine + statusPart } }));
      // Hand off to chat so Claude can diagnose and guide the fix.
      sendChatMessage(
        `Credentials test failed for **${entry.name}** (\`${entry.id}\`).\n\n` +
        `**Scope:** ${entry.scope}\n` +
        `**Fields:** ${entry.fields.map(f => f.envVar).join(', ')}\n` +
        `**Error:** ${errLine}${statusPart}${detailsPart}\n\n` +
        `Please help me figure out what's wrong — is it a wrong value, missing scope, expired token, or something else?`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTests(prev => ({ ...prev, [entry.id]: { status: 'fail', message: msg } }));
      sendChatMessage(
        `Credentials test for **${entry.name}** could not reach the bridge. Error: ${msg}. ` +
        `Is the bridge running? (expected at /api/credentials/test)`
      );
    }
  }

  async function handleAddCustom() {
    setCustomError(null);
    if (!customName.trim() || !customEnv.trim()) return;
    const envVar = customEnv.trim().toUpperCase().replace(/\s+/g, '_');

    // Optional MCP server registration: if the user filled in the MCP name +
    // JSON spec, the same submit creates the .mcp.json entry alongside the
    // credential slot. One action wires both halves of the tool.
    let mcp: { name: string; spec: unknown } | undefined;
    if (customMcpName.trim() || customMcpSpec.trim()) {
      if (!customMcpName.trim() || !customMcpSpec.trim()) {
        setCustomError('MCP name and spec must both be provided, or both left blank');
        return;
      }
      let parsedSpec: unknown;
      try { parsedSpec = JSON.parse(customMcpSpec); }
      catch (e) {
        setCustomError(`MCP spec is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      mcp = { name: customMcpName.trim(), spec: parsedSpec };
    }

    const payload = {
      name: customName.trim(),
      scope: customScope.trim() || `Custom credential — ${envVar}`,
      fields: [{
        id: envVar.toLowerCase(),
        label: 'Value',
        envVar,
        type: 'password' as const,
      }],
      mcp,
    };

    setCustomSaving(true);
    try {
      const r = await fetch('/api/tools/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json() as {
        ok: boolean;
        entry?: {
          id: string;
          name: string;
          scope: string;
          docsUrl?: string;
          fields: Array<{ id: string; label: string; envVar: string; type: 'password' | 'text'; placeholder?: string }>;
        };
        error?: string;
      };
      if (!j.ok || !j.entry) {
        setCustomError(j.error || 'failed to register tool');
        return;
      }
      const entry: CredentialEntry = {
        id: j.entry.id,
        provider: 'custom',
        name: j.entry.name,
        scope: j.entry.scope,
        docsUrl: j.entry.docsUrl,
        fields: j.entry.fields.map(f => ({
          id: f.id,
          label: f.label,
          envVar: f.envVar,
          type: f.type === 'text' ? 'text' : 'password',
          placeholder: f.placeholder,
        })),
      };
      setCustomEntries(prev => [...prev, entry]);
      setExpanded(prev => ({ ...prev, custom: true }));
      setCustomName('');
      setCustomEnv('');
      setCustomScope('');
      setCustomMcpName('');
      setCustomMcpSpec('');
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomSaving(false);
    }
  }

  async function handleRemoveCustom(entryId: string) {
    if (!window.confirm('Remove this custom tool? Saved env values stay in .env — only the slot definition is removed.')) return;
    try {
      const r = await fetch(`/api/tools/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      const j = await r.json() as { ok: boolean; error?: string };
      if (!j.ok) {
        setCustomError(j.error || 'failed to remove tool');
        return;
      }
      setCustomEntries(prev => prev.filter(e => e.id !== entryId));
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : String(err));
    }
  }

  // Group entries by provider in PROVIDERS order.
  const grouped = useMemo(() => {
    const byProvider = new Map<string, CredentialEntry[]>();
    for (const entry of allEntries) {
      const arr = byProvider.get(entry.provider) || [];
      arr.push(entry);
      byProvider.set(entry.provider, arr);
    }
    return PROVIDERS.map(p => ({
      provider: p,
      entries: byProvider.get(p.id) || [],
    })).filter(g => g.entries.length > 0 || g.provider.id === 'custom');
  }, [allEntries]);

  return (
    <div className="credentials__overlay" onClick={onClose}>
      <div className="credentials__box" onClick={e => e.stopPropagation()}>
        <div className="credentials__header">
          <span className="credentials__title">Credentials</span>
          <button className="credentials__close" onClick={onClose}>&times;</button>
        </div>

        <div className="credentials__list">
          {grouped.map(({ provider, entries }) => {
            const totalFields = entries.reduce((n, e) => n + e.fields.length, 0);
            const setFields = entries.reduce(
              (n, e) => n + e.fields.filter(f => isFieldSet(f.envVar)).length,
              0
            );
            const isOpen = expanded[provider.id];
            return (
              <div key={provider.id} className="credentials__group">
                <button
                  className="credentials__group-header"
                  onClick={() => toggle(provider.id)}
                  style={{ borderLeftColor: provider.color }}
                >
                  <span className={`credentials__chevron ${isOpen ? 'credentials__chevron--open' : ''}`}>▸</span>
                  <span className="credentials__group-label">{provider.label}</span>
                  <span className="credentials__group-count">
                    {totalFields === 0
                      ? 'add custom credentials below'
                      : `${setFields}/${totalFields}`}
                  </span>
                </button>

                {isOpen && entries.map(entry => {
                  const entrySetCount = entry.fields.filter(f => isFieldSet(f.envVar)).length;
                  const entryComplete = entrySetCount === entry.fields.length;
                  const test = tests[entry.id] || { status: 'idle' as const };
                  const save = saves[entry.id] || { status: 'idle' as const };
                  const hasInput = entry.fields.some(f => (values[f.id] || '').trim());
                  // Test is available if the user has any input OR every required field is already set.
                  const canTest = hasInput || entryComplete;
                  return (
                  <div key={entry.id} className="credentials__entry">
                    <div className="credentials__entry-head">
                      <div className="credentials__entry-title">
                        <span
                          className={`credentials__entry-status credentials__entry-status--${entryComplete ? 'complete' : entrySetCount > 0 ? 'partial' : 'empty'}`}
                          title={entryComplete ? 'All fields set' : `${entrySetCount} of ${entry.fields.length} set`}
                        />
                        <span className="credentials__key-name">{entry.name}</span>
                      </div>
                      <div className="credentials__entry-actions">
                        <button
                          className={`credentials__test-btn credentials__test-btn--${test.status}`}
                          onClick={() => handleTestEntry(entry)}
                          disabled={!canTest || test.status === 'testing'}
                          title={
                            test.status === 'pass' ? test.message :
                            test.status === 'fail' ? test.message :
                            'Check that these credentials actually work against the provider'
                          }
                        >
                          {test.status === 'testing' ? 'testing…'
                            : test.status === 'pass' ? '✓ valid'
                            : test.status === 'fail' ? '✗ retry test'
                            : 'test'}
                        </button>
                        <button
                          className={`credentials__save-btn credentials__save-btn--${save.status}`}
                          onClick={() => handleSaveEntry(entry)}
                          disabled={!hasInput || save.status === 'saving'}
                          title={save.status === 'error' ? save.message : save.status === 'saved' ? save.message : 'Write to dotfiles, commit, push, and verify'}
                        >
                          {save.status === 'saving' ? 'saving…'
                            : save.status === 'saved' ? '✓ saved'
                            : save.status === 'error' ? '✗ retry save'
                            : 'save'}
                        </button>
                        {entry.provider === 'custom' && (
                          <button
                            onClick={() => handleRemoveCustom(entry.id)}
                            title="Remove this custom tool slot from the registry"
                            style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 3, padding: '1px 7px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-family-mono)' }}
                          >×</button>
                        )}
                      </div>
                    </div>
                    {test.status === 'fail' && test.message && (
                      <div className="credentials__test-error">
                        {test.message} — sent to chat for help.
                      </div>
                    )}
                    {save.status === 'error' && save.message && (
                      <div className="credentials__test-error">
                        {save.message}
                      </div>
                    )}
                    {save.status === 'saved' && save.message && (
                      <div className="credentials__save-ok">
                        {save.message}
                      </div>
                    )}
                    {entry.id === 'anthropic' && (
                      <SubscriptionPanel
                        endpoint="claude-auth"
                        title="Claude subscription (Pro / Max)"
                        subscriptionAuthMethod="claude.ai"
                        apiFallbackEnvVar="ANTHROPIC_API_KEY"
                        idleHint={<>Sign in with your Anthropic account instead of pasting an API key. Same flow as <code>claude auth login</code>.</>}
                      />
                    )}
                    {entry.id === 'openai' && (
                      <SubscriptionPanel
                        endpoint="codex-auth"
                        title="ChatGPT subscription (Plus / Pro / Team)"
                        subscriptionAuthMethod="chatgpt"
                        apiFallbackEnvVar="OPENAI_API_KEY"
                        idleHint={<>Sign in with your ChatGPT account to use your subscription quota instead of pasting an API key. Same flow as <code>codex login</code>.</>}
                      />
                    )}
                    <div className="credentials__scope">
                      <span className="credentials__scope-label">Grants:</span> {entry.scope}
                    </div>
                    {(entry.docsUrl || entry.howTo) && (
                      <div className="credentials__howto">
                        <span className="credentials__howto-label">Where:</span>
                        {entry.howTo && <span className="credentials__howto-text"> {entry.howTo}</span>}
                        {entry.docsUrl && (
                          <a
                            className="credentials__howto-link"
                            href={entry.docsUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            open page ↗
                          </a>
                        )}
                      </div>
                    )}
                    {entry.fields.map(field => {
                      const setAlready = isFieldSet(field.envVar);
                      const defaultPlaceholder = field.type === 'password'
                        ? `paste ${field.label.toLowerCase()}…`
                        : `enter ${field.label.toLowerCase()}…`;
                      return (
                        <div key={field.id} className="credentials__field">
                          <div className="credentials__row-info">
                            <span className={`credentials__dot credentials__dot--${setAlready ? 'set' : 'unset'}`} />
                            <span className="credentials__field-label">{field.label}</span>
                            <span className="credentials__env-var">{field.envVar}</span>
                            {field.docsUrl && (
                              <a
                                className="credentials__howto-link"
                                href={field.docsUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                title={field.hint}
                              >
                                where ↗
                              </a>
                            )}
                          </div>
                          {field.hint && (
                            <div className="credentials__field-hint">{field.hint}</div>
                          )}
                          <input
                            type={field.type === 'password' ? 'password' : 'text'}
                            className="credentials__input"
                            placeholder={setAlready && !values[field.id]
                              ? (field.type === 'password' ? '•••••••• (already set)' : 'already set')
                              : (field.placeholder || defaultPlaceholder)
                            }
                            value={values[field.id] || ''}
                            onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && handleSaveEntry(entry)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Add a custom tool — credential slot, optionally with an MCP server. */}
        <div className="credentials__add">
          <input
            className="credentials__input credentials__input--half"
            placeholder="Name (e.g. Postmark)"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
          />
          <input
            className="credentials__input credentials__input--half"
            placeholder="ENV_VAR"
            value={customEnv}
            onChange={e => setCustomEnv(e.target.value)}
          />
          <input
            className="credentials__input"
            placeholder="What does it grant access to?"
            value={customScope}
            onChange={e => setCustomScope(e.target.value)}
          />
          <input
            className="credentials__input credentials__input--half"
            placeholder="MCP server name (optional)"
            value={customMcpName}
            onChange={e => setCustomMcpName(e.target.value)}
          />
          <input
            className="credentials__input credentials__input--half"
            placeholder='MCP spec JSON (optional, e.g. {"command":"npx","args":["-y","@x/mcp"],"env":{"X_KEY":"${X_API_KEY}"}})'
            value={customMcpSpec}
            onChange={e => setCustomMcpSpec(e.target.value)}
          />
          <button
            className="credentials__save-btn"
            onClick={handleAddCustom}
            disabled={!customName.trim() || !customEnv.trim() || customSaving}
          >
            {customSaving ? 'adding…' : '+ add'}
          </button>
          {customError && (
            <div className="credentials__test-error" style={{ width: '100%' }}>
              {customError}
            </div>
          )}
        </div>

        <div className="credentials__footer">
          Save writes to a Codespace-shared dotfiles .env (commit + push) when one exists, otherwise to <code>.env</code> at the repo root (auto-gitignored, never committed). Either way values become available to the bridge immediately. Adding an MCP name + spec also wires the tool into <code>.mcp.json</code> in one step. Nothing is sent through chat.
        </div>
      </div>
    </div>
  );
}
