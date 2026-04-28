import { useState } from "react";
import type { Profile } from "../types";

type EngineId = "anthropic" | "openai";

export function EngineSetup({
  availableEngines = [],
  onReady,
}: {
  availableEngines?: EngineId[];
  onReady: (profile: Profile) => void;
}) {
  const [aiName, setAiName] = useState("");
  const [engine, setEngine] = useState<EngineId>(availableEngines[0] || "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedEngineAlreadyConfigured = availableEngines.includes(engine);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/engine/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aiName, engine, apiKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "setup failed");
      onReady(body.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup">
      <section className="setup__panel">
        <div className="setup__eyebrow">ai-os</div>
        <h1>Name the AI and connect an engine.</h1>
        <div className="setup__field">
          <label htmlFor="ai-name">AI name</label>
          <input
            id="ai-name"
            value={aiName}
            onChange={(e) => setAiName(e.target.value)}
            placeholder="Atlas"
            autoFocus
          />
        </div>

        <div className="setup__field">
          <label htmlFor="engine">Engine</label>
          <select id="engine" value={engine} onChange={(e) => setEngine(e.target.value as EngineId)}>
            <option value="anthropic">Anthropic Claude</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>

        <div className="setup__field">
          <label htmlFor="api-key">{engine === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}</label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              selectedEngineAlreadyConfigured
                ? "Already available in this environment"
                : engine === "anthropic"
                  ? "sk-ant-..."
                  : "sk-..."
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>

        <button
          className="setup__submit"
          onClick={submit}
          disabled={busy || !aiName.trim() || (!selectedEngineAlreadyConfigured && !apiKey.trim())}
        >
          {busy ? "Saving..." : "Start"}
        </button>

        {error && <div className="setup__error">{error}</div>}
        <p className="setup__note">
          Credentials are saved only to this clone's gitignored <code>.env</code>.
        </p>
      </section>
    </main>
  );
}
