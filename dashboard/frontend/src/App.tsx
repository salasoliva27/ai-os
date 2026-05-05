import { useEffect, useState } from 'react';
import { WindowShell } from './components/WindowShell';
import { WindowManagerProvider } from './store/window-store';
import { TopBar } from './components/TopBar';
import { CommandPalette } from './components/CommandPalette';
import { PortfolioScoreboard } from './components/PortfolioScoreboard';
import { CrossProjectFlash } from './components/CrossProjectFlash';
import { ThemeEngine, useThemeInit } from './components/ThemeEngine';
import { Credentials } from './components/Credentials';
import { FirstRunOnboarding } from './components/FirstRunOnboarding';
import { McpConfig } from './components/McpConfig';
import { LearningToast } from './components/LearningToast';
import { DashboardProvider, useBridgeHandler, useRegisterWsSend, useConnectionStateSync } from './store';
import { useWebSocket } from './hooks/useWebSocket';
import type { ServerMessage } from './types/bridge';

function ReloadBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let initialHash = '';
    const check = async () => {
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        const text = await res.text();
        // Extract asset filenames as a fingerprint
        const hash = (text.match(/assets\/index-[^"]+/g) || []).join(',');
        if (!initialHash) { initialHash = hash; return; }
        if (hash && hash !== initialHash) setStale(true);
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, []);

  if (!stale) return null;
  return (
    <div className="reload-banner" onClick={() => window.location.reload()}>
      UI updated — click to reload
    </div>
  );
}

function DashboardInner() {
  const { status, lastMessage, send, onMessage } = useWebSocket();
  const handleBridgeMessage = useBridgeHandler();
  const registerWsSend = useRegisterWsSend();
  const { onConnectionLost, onConnectionRestored } = useConnectionStateSync();
  const [themeOpen, setThemeOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentialsInitialProvider, setCredentialsInitialProvider] = useState<string | undefined>(undefined);
  const [mcpOpen, setMcpOpen] = useState(false);

  useThemeInit();

  // Route every WebSocket message synchronously into the store.
  // Cannot rely on the `lastMessage` state value here — same-tick bursts
  // collapse into a single render (only the last message survives).
  useEffect(() => {
    onMessage(handleBridgeMessage);
  }, [onMessage, handleBridgeMessage]);

  // Register WebSocket send function with store when connected
  useEffect(() => {
    if (status === 'connected') {
      registerWsSend(send);
    }
  }, [status, send, registerWsSend]);

  // When the bridge drops mid-turn, demote stuck thinking/streaming sessions
  // so the UI stops showing "responding" when nothing is coming back.
  useEffect(() => {
    if (status === 'disconnected') onConnectionLost();
    else if (status === 'connected') onConnectionRestored();
  }, [status, onConnectionLost, onConnectionRestored]);

  // Theme shortcut: Ctrl+T
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        setThemeOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell-outer">
      <TopBar connectionStatus={status} onThemeToggle={() => setThemeOpen(true)} lastMessage={lastMessage} onCredentials={() => setCredentialsOpen(true)} onMcpConfig={() => setMcpOpen(true)} />
      <div className="shell-panels">
        <WindowManagerProvider>
          <WindowShell />
        </WindowManagerProvider>
      </div>
      <CommandPalette />
      <PortfolioScoreboard />
      <CrossProjectFlash />
      {themeOpen && <ThemeEngine onClose={() => setThemeOpen(false)} />}
      {credentialsOpen && <Credentials onClose={() => { setCredentialsOpen(false); setCredentialsInitialProvider(undefined); }} initialProviderId={credentialsInitialProvider} />}
      {mcpOpen && <McpConfig onClose={() => setMcpOpen(false)} />}
      <FirstRunOnboarding onOpenCredentials={(tabId) => { setCredentialsInitialProvider(tabId); setCredentialsOpen(true); }} />
      <LearningToast />
      <ReloadBanner />
    </div>
  );
}

export default function App() {
  return (
    <DashboardProvider>
      <DashboardInner />
    </DashboardProvider>
  );
}
