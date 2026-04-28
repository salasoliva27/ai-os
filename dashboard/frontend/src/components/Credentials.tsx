import { useState } from "react";

const PRESET_KEYS = [
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", required: false, help: "Enables Claude as an engine." },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", required: false, help: "Enables OpenAI as an engine." },
  { key: "BRAVE_API_KEY", label: "Brave Search API key", required: false, help: "Optional. Enables the research panel." },
  { key: "GITHUB_TOKEN", label: "GitHub token (PAT)", required: false, help: "Optional. Cross-repo push access." },
];

export function Credentials() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [customKey, setCustomKey] = useState("");
  const [customVal, setCustomVal] = useState("");

  async function save(key: string, value: string) {
    if (!value) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/credentials/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "save failed");
      setSavedKeys((s) => new Set(s).add(key));
      setValues((v) => ({ ...v, [key]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveCustom() {
    const k = customKey.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(k)) {
      setError("Key must be UPPER_SNAKE_CASE letters/digits/underscore.");
      return;
    }
    await save(k, customVal);
    setCustomKey("");
    setCustomVal("");
  }

  return (
    <div className="panel-body">
      <p className="muted">
        Keys are written to <code>.env</code> at the repo root. The bridge
        ensures <code>.env</code> is gitignored so nothing is committed.
      </p>

      {PRESET_KEYS.map(({ key, label, required, help }) => (
        <div key={key} className="cred-row">
          <label>
            {label} {required && <span className="req">required</span>}
            {savedKeys.has(key) && <span className="ok">✓ saved</span>}
          </label>
          <div className="cred-help">{help}</div>
          <div className="cred-input">
            <input
              type="password"
              placeholder={key}
              value={values[key] || ""}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
            <button
              onClick={() => save(key, values[key] || "")}
              disabled={busy === key || !(values[key] || "").trim()}
            >
              {busy === key ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ))}

      <hr />

      <h3>Add a custom credential</h3>
      <div className="cred-row">
        <div className="cred-input">
          <input
            placeholder="MY_API_KEY"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
          />
          <input
            type="password"
            placeholder="value"
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value)}
          />
          <button onClick={saveCustom} disabled={busy !== null || !customKey || !customVal}>
            Add
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
