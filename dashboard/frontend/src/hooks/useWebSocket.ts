import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../types/bridge";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseWebSocketResult {
  status: ConnectionStatus;
  lastMessage: ServerMessage | null;
  send: (msg: ClientMessage) => void;
  // Register a synchronous handler invoked once per incoming WS message.
  // Bypasses React state batching, which otherwise coalesces same-tick
  // bursts (e.g. 6 project_update messages arriving in 2ms) and drops all
  // but the last because `lastMessage` setState is debounced into one render.
  onMessage: (handler: (m: ServerMessage) => void) => void;
}

const MAX_BACKOFF = 10_000;
// Cap the outbox so a long disconnect can't grow it unbounded.
const MAX_OUTBOX = 50;

export function useWebSocket(): UseWebSocketResult {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const mountedRef = useRef(true);
  // Messages submitted while the socket is closed get queued here and
  // flushed on the next successful onopen, so a brief bridge restart
  // doesn't silently swallow user prompts.
  const outboxRef = useRef<ClientMessage[]>([]);
  // Synchronous fan-out for inbound messages (see UseWebSocketResult.onMessage).
  const inboundHandlerRef = useRef<((m: ServerMessage) => void) | null>(null);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      backoffRef.current = 1000;
      // Flush anything queued during the disconnect, in order.
      while (outboxRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
        const msg = outboxRef.current.shift()!;
        try { ws.send(JSON.stringify(msg)); } catch { break; }
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const parsed = JSON.parse(event.data) as ServerMessage;
        // Synchronous path: deliver to the registered handler immediately.
        // Each message reaches the consumer regardless of React's batching.
        inboundHandlerRef.current?.(parsed);
        // Legacy path: also expose the latest via state for any code still
        // reading useWebSocket().lastMessage. Same-tick bursts collapse here,
        // but the synchronous path above already handled them all.
        setLastMessage(parsed);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      wsRef.current = null;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF);
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else if (outboxRef.current.length < MAX_OUTBOX) {
      // Queue for delivery once the socket reopens.
      outboxRef.current.push(msg);
    }
  }, []);

  const onMessage = useCallback((handler: (m: ServerMessage) => void) => {
    inboundHandlerRef.current = handler;
  }, []);

  return { status, lastMessage, send, onMessage };
}
