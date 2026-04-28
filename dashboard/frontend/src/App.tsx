import { useCallback, useEffect, useState } from "react";
import { Chat } from "./components/Chat";
import { Credentials } from "./components/Credentials";
import { EngineSetup } from "./components/EngineSetup";
import { WindowShell, type PanelRegistry } from "./components/WindowShell";
import { WindowManagerProvider, useWindowManager, buildPanelWindow } from "./store/window-store";
import type { PanelId } from "./types/window";
import type { Profile } from "./types";

const PANEL_LABELS: Record<PanelId, string> = {
  chat: "Chat",
  credentials: "Credentials",
  files: "Files",
  tasks: "Tasks",
  memory: "Memory",
  calendar: "Calendar",
  research: "Research",
};

export default function App() {
  return (
    <WindowManagerProvider>
      <Workspace />
    </WindowManagerProvider>
  );
}

function Workspace() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [engineConfigured, setEngineConfigured] = useState<boolean | null>(null);
  const [availableEngines, setAvailableEngines] = useState<Array<"anthropic" | "openai">>([]);
  const { layout, dispatch } = useWindowManager();

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((health) => {
        setProfile(health.profile || null);
        setEngineConfigured(Boolean(health.engineConfigured));
        setAvailableEngines(Array.isArray(health.availableEngines) ? health.availableEngines : []);
      })
      .catch(() => {
        setProfile(null);
        setEngineConfigured(false);
      });
  }, []);

  const refreshProfile = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((health) => {
        setProfile(health.profile || null);
        setEngineConfigured(Boolean(health.engineConfigured));
        setAvailableEngines(Array.isArray(health.availableEngines) ? health.availableEngines : []);
      })
      .catch(() => {});
  }, []);

  if (engineConfigured === null) {
    return <div className="setup setup--loading">Loading...</div>;
  }

  if (!engineConfigured || !profile?.aiName) {
    return (
      <EngineSetup
        availableEngines={availableEngines}
        onReady={(nextProfile) => {
          setProfile(nextProfile);
          setEngineConfigured(true);
          setAvailableEngines((current) =>
            nextProfile.defaultEngine && !current.includes(nextProfile.defaultEngine)
              ? [...current, nextProfile.defaultEngine]
              : current
          );
        }}
      />
    );
  }

  const enabled = (profile?.enabledTools as PanelId[] | undefined) || ["credentials"];
  const visiblePanels: PanelId[] = ["chat", ...enabled.filter((p) => p !== "chat")];
  const brand = profile?.aiName || profile?.aiKind || "ai-os";

  function openPanel(id: PanelId) {
    const winId = `win-${id}`;
    const existing = layout.windows.find((w) => w.id === winId);
    if (existing) {
      dispatch({ type: "RESTORE", id: winId });
      dispatch({ type: "FOCUS", id: winId });
      return;
    }
    dispatch({ type: "ADD", window: buildPanelWindow(id, layout.windows.length) });
  }

  const panels: PanelRegistry = {
    chat: { render: () => <Chat onProfileMaybeChanged={refreshProfile} /> },
    credentials: { render: () => <Credentials /> },
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">{brand}</div>
        <nav className="panels">
          {visiblePanels.map((id) => (
            <button
              key={id}
              className="panel-btn"
              onClick={() => openPanel(id)}
              title={`Open ${PANEL_LABELS[id]}`}
            >
              {PANEL_LABELS[id] || id}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        <WindowShell panels={panels} brand={brand} />
      </main>
    </div>
  );
}
