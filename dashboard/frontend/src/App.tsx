import { useCallback, useEffect, useState } from "react";
import { Chat } from "./components/Chat";
import { Credentials } from "./components/Credentials";
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
  const { layout, dispatch } = useWindowManager();

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  const refreshProfile = useCallback(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => {});
  }, []);

  const enabled = (profile?.enabledTools as PanelId[] | undefined) || ["credentials"];
  const visiblePanels: PanelId[] = ["chat", ...enabled.filter((p) => p !== "chat")];

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
        <div className="brand">ai-os</div>
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
        <WindowShell panels={panels} />
      </main>
    </div>
  );
}
