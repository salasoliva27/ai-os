import { useEffect, useState } from "react";
import { Chat } from "./components/Chat";
import { Credentials } from "./components/Credentials";
import type { Profile } from "./types";

const PANEL_LABELS: Record<string, string> = {
  credentials: "Credentials",
  files: "Files",
  tasks: "Tasks",
  memory: "Memory",
  calendar: "Calendar",
  research: "Research",
};

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  function refreshProfile() {
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => {});
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ai-os</div>
        <nav className="panels">
          {(profile?.enabledTools || ["credentials"]).map((id) => (
            <button
              key={id}
              className="panel-btn"
              onClick={() => setOpenPanel(openPanel === id ? null : id)}
            >
              {PANEL_LABELS[id] || id}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        <Chat onProfileMaybeChanged={refreshProfile} />
      </main>

      {openPanel === "credentials" && (
        <Credentials onClose={() => setOpenPanel(null)} />
      )}
      {openPanel && openPanel !== "credentials" && (
        <PanelPlaceholder name={openPanel} onClose={() => setOpenPanel(null)} />
      )}
    </div>
  );
}

function PanelPlaceholder({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{PANEL_LABELS[name] || name}</h2>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p>
            This panel is enabled in your profile but not yet implemented.
            Ask the chat to scaffold it for you, or open <code>dashboard/frontend/src/components/</code>
            and add a <code>{name[0].toUpperCase() + name.slice(1)}.tsx</code> file.
          </p>
        </div>
      </div>
    </div>
  );
}
