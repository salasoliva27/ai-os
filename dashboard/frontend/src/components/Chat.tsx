import { useEffect, useRef, useState } from "react";
import type { WsOut } from "../types";

type Msg = { role: "user" | "assistant"; text: string };

export function Chat({ onProfileMaybeChanged }: { onProfileMaybeChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;

    function connect() {
      if (stopped) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
      };
      ws.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        attempt += 1;
        setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        let m: WsOut;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.type === "chunk") {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, text: last.text + m.text };
            } else {
              next.push({ role: "assistant", text: m.text });
            }
            return next;
          });
        } else if (m.type === "done") {
          setStreaming(false);
          onProfileMaybeChanged();
        } else if (m.type === "error") {
          setMessages((prev) => [...prev, { role: "assistant", text: `⚠ ${m.message}` }]);
          setStreaming(false);
        }
      };
    }

    connect();
    return () => {
      stopped = true;
      wsRef.current?.close();
    };
  }, [onProfileMaybeChanged]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text || streaming || status !== "connected") return;
    wsRef.current?.send(JSON.stringify({ type: "prompt", text }));
    setMessages((p) => [...p, { role: "user", text }]);
    setInput("");
    setStreaming(true);
  }

  return (
    <div className="chat">
      <div className="chat-status">
        <span className={`dot ${status}`} /> {status}
      </div>
      <div className="chat-scroller" ref={scrollerRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            Start the conversation. The AI will ask what you want this workspace to be.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role}</div>
            <div className="msg-text">{stripProfileBlock(m.text)}</div>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={status === "connected" ? "Type a message…" : "Connecting…"}
          rows={2}
        />
        <button onClick={send} disabled={streaming || status !== "connected"}>
          Send
        </button>
      </div>
    </div>
  );
}

function stripProfileBlock(text: string): string {
  return text.replace(/<<PROFILE:\s*\{[^}]*\}\s*>>/g, "").trim();
}
