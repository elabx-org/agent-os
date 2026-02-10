"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../constants";

export interface WebSocketCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onConnectionStateChange: (
    state: "connecting" | "connected" | "disconnected" | "reconnecting"
  ) => void;
  onSetConnected: (connected: boolean) => void;
}

export interface WebSocketManager {
  ws: WebSocket;
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  sendResize: (cols: number, rows: number) => void;
  reconnect: () => void;
  cleanup: () => void;
}

// Application-level keepalive interval (keeps reverse proxy happy)
const CLIENT_PING_INTERVAL_MS = 20_000; // 20s

export function createWebSocketConnection(
  term: XTerm,
  callbacks: WebSocketCallbacks,
  wsRef: React.MutableRefObject<WebSocket | null>,
  reconnectTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>,
  reconnectDelayRef: React.MutableRefObject<number>,
  intentionalCloseRef: React.MutableRefObject<boolean>
): WebSocketManager {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  // Session ID for PTY reattachment across reconnects
  let sessionId: string | null = null;
  let clientPingInterval: ReturnType<typeof setInterval> | null = null;

  function buildWsUrl(): string {
    const base = `${protocol}//${window.location.host}/ws/terminal`;
    return sessionId ? `${base}?sessionId=${sessionId}` : base;
  }

  function startClientPing(ws: WebSocket) {
    stopClientPing();
    clientPingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, CLIENT_PING_INTERVAL_MS);
  }

  function stopClientPing() {
    if (clientPingInterval) {
      clearInterval(clientPingInterval);
      clientPingInterval = null;
    }
  }

  const ws = new WebSocket(buildWsUrl());
  wsRef.current = ws;

  const sendResize = (cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };

  const sendInput = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  };

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", data: command }));
    }
  };

  // Handler functions defined once and reused across reconnects
  function handleOpen() {
    callbacks.onSetConnected(true);
    callbacks.onConnectionStateChange("connected");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    // Only fire onConnected for fresh connections (sessionId is null).
    // On reconnects (sessionId is set from previous connection), the PTY
    // is still alive with tmux running — firing onConnected would re-send
    // the tmux attach command into the active session.
    if (!sessionId) {
      callbacks.onConnected?.();
    }
    sendResize(term.cols, term.rows);
    term.focus();
    startClientPing(wsRef.current!);
  }

  // Fight against Claude Code's forced top-scrolling bug
  // See: https://github.com/anthropics/claude-code/issues/826
  function handleMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "session") {
        // Server sent us the session ID (and optional buffered output)
        sessionId = msg.sessionId;
        if (msg.buffered) {
          // Write buffered output to terminal (replay what happened during disconnect)
          term.write(msg.buffered);
        }
        return;
      }

      if (msg.type === "output") {
        const buffer = term.buffer.active;
        const scrollYBefore = buffer.viewportY;
        const wasAtTop = scrollYBefore <= 0;
        const wasAtBottom = scrollYBefore >= buffer.baseY;

        term.write(msg.data);

        // After write, check if scroll jumped to top unexpectedly
        requestAnimationFrame(() => {
          const scrollYAfter = term.buffer.active.viewportY;
          const isNowAtTop = scrollYAfter <= 0;

          if (isNowAtTop && !wasAtTop && !wasAtBottom && scrollYBefore > 5) {
            term.scrollToLine(scrollYBefore);
          }
        });
      } else if (msg.type === "exit") {
        term.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
        sessionId = null; // Session is gone, don't try to reattach
      } else if (msg.type === "pong") {
        // Server responded to our app-level ping — connection is alive
      }
    } catch {
      term.write(event.data);
    }
  }

  function handleClose() {
    stopClientPing();
    callbacks.onSetConnected(false);
    callbacks.onDisconnected?.();

    if (intentionalCloseRef.current) {
      callbacks.onConnectionStateChange("disconnected");
      return;
    }

    callbacks.onConnectionStateChange("disconnected");

    const currentDelay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(
      currentDelay * 2,
      WS_RECONNECT_MAX_DELAY
    );
    reconnectTimeoutRef.current = setTimeout(attemptReconnect, currentDelay);
  }

  function handleError() {
    // Errors are handled by onclose
  }

  // Force reconnect — kills existing connection and creates fresh one
  // Reuses the saved sessionId to reattach to the same PTY
  const forceReconnect = () => {
    if (intentionalCloseRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopClientPing();

    // Force close existing socket
    const oldWs = wsRef.current;
    if (oldWs) {
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try { oldWs.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    callbacks.onConnectionStateChange("reconnecting");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;

    // Create fresh connection — include sessionId for PTY reattachment
    const newWs = new WebSocket(buildWsUrl());
    wsRef.current = newWs;
    newWs.onopen = handleOpen;
    newWs.onmessage = handleMessage;
    newWs.onclose = handleClose;
    newWs.onerror = handleError;
  };

  // Soft reconnect — only if not already connected
  const attemptReconnect = () => {
    if (intentionalCloseRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    forceReconnect();
  };

  // Attach handlers to initial WebSocket
  ws.onopen = handleOpen;
  ws.onmessage = handleMessage;
  ws.onclose = handleClose;
  ws.onerror = handleError;

  // Handle terminal input
  term.onData((data) => {
    sendInput(data);
  });

  // Handle Shift+Enter for multi-line input
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown" && event.key === "Enter" && event.shiftKey) {
      sendInput("\n");
      return false;
    }
    return true;
  });

  // Track when page was last hidden (for detecting long sleeps)
  let hiddenAt: number | null = null;

  const handleVisibilityChange = () => {
    if (intentionalCloseRef.current) return;

    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }

    if (document.visibilityState !== "visible") return;

    const wasHiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;

    // If hidden for more than 5 seconds, force reconnect (iOS Safari kills sockets)
    if (wasHiddenFor > 5000) {
      forceReconnect();
      return;
    }

    // Otherwise only reconnect if actually disconnected
    const currentWs = wsRef.current;
    const isDisconnected =
      !currentWs ||
      currentWs.readyState === WebSocket.CLOSED ||
      currentWs.readyState === WebSocket.CLOSING;
    const isStaleConnection = currentWs?.readyState === WebSocket.CONNECTING;

    if (isDisconnected || isStaleConnection) {
      forceReconnect();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const cleanup = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    stopClientPing();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const currentWs = wsRef.current;
    if (
      currentWs &&
      (currentWs.readyState === WebSocket.OPEN ||
        currentWs.readyState === WebSocket.CONNECTING)
    ) {
      currentWs.close(1000, "Component unmounting");
    }
  };

  return {
    ws,
    sendInput,
    sendCommand,
    sendResize,
    reconnect: forceReconnect,
    cleanup,
  };
}
