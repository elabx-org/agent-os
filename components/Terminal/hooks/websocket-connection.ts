"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../constants";
import { typingElsewhere } from "@/lib/typing-elsewhere";
import { clientLog } from "@/lib/client-log";

export interface WebSocketCallbacks {
  /** replacedPty: a reconnect landed on a new PTY, so tmux must be re-attached */
  onConnected?: (info: { replacedPty: boolean }) => void;
  onDisconnected?: () => void;
  onConnectionStateChange: (
    state: "connecting" | "connected" | "disconnected" | "reconnecting"
  ) => void;
  onSetConnected: (connected: boolean) => void;
}

export interface WebSocketManager {
  ws: WebSocket;
  sendInput: (data: string) => void;
  sendPaste: (data: string) => void;
  sendCommand: (command: string) => void;
  sendResize: (cols: number, rows: number) => void;
  reconnect: () => void;
  cleanup: () => void;
}

// Application-level keepalive interval (keeps reverse proxy happy)
const CLIENT_PING_INTERVAL_MS = 20_000; // 20s
// The server answers every ping, so silence this long means a dead socket
// that never fired onclose (phone slept, network changed)
const SERVER_SILENCE_TIMEOUT_MS = 60_000;
// A handshake still going after this is stuck (a phone just woken, its
// network not back yet): the browser can wait a minute or more before it
// gives up, all of it on "Connecting...". Start a fresh one instead.
const HANDSHAKE_TIMEOUT_MS = 5_000;

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
  let lastServerMessageAt = Date.now();

  function buildWsUrl(): string {
    const base = `${protocol}//${window.location.host}/ws/terminal`;
    return sessionId ? `${base}?sessionId=${sessionId}` : base;
  }

  function startClientPing(ws: WebSocket) {
    stopClientPing();
    lastServerMessageAt = Date.now();
    clientPingInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Timers are throttled while hidden; visibilitychange handles that case
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastServerMessageAt > SERVER_SILENCE_TIMEOUT_MS
      ) {
        forceReconnect();
        return;
      }
      ws.send(JSON.stringify({ type: "ping" }));
    }, CLIENT_PING_INTERVAL_MS);
  }

  function stopClientPing() {
    if (clientPingInterval) {
      clearInterval(clientPingInterval);
      clientPingInterval = null;
    }
  }

  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let connectStartedAt = 0;

  function clearHandshake() {
    if (handshakeTimer) clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }

  function watchHandshake(sock: WebSocket) {
    clearHandshake();
    connectStartedAt = Date.now();
    handshakeTimer = setTimeout(() => {
      handshakeTimer = null;
      if (wsRef.current !== sock || sock.readyState !== WebSocket.CONNECTING)
        return;
      clientLog(`terminal socket stuck ${HANDSHAKE_TIMEOUT_MS}ms, retrying`);
      forceReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
  }

  const ws = new WebSocket(buildWsUrl());
  wsRef.current = ws;
  watchHandshake(ws);

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

  const sendPaste = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "paste", data }));
    }
  };

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", data: command }));
    }
  };

  // Handler functions defined once and reused across reconnects
  function handleOpen() {
    clearHandshake();
    clientLog(
      `terminal socket open after ${Date.now() - connectStartedAt}ms${sessionId ? " (again)" : ""}`
    );
    callbacks.onSetConnected(true);
    callbacks.onConnectionStateChange("connected");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    // onConnected fires from the "session" message, once the server says
    // whether this is the same PTY (tmux still attached) or a new one
    sendResize(term.cols, term.rows);
    if (!typingElsewhere(term.element)) term.focus();
    startClientPing(wsRef.current!);
  }

  // Fight against Claude Code's forced top-scrolling bug
  // See: https://github.com/anthropics/claude-code/issues/826
  function handleMessage(event: MessageEvent) {
    lastServerMessageAt = Date.now();
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "session") {
        // Server sent us the session ID (and optional buffered output)
        const hadSession = sessionId !== null;
        sessionId = msg.sessionId;
        if (!msg.reattached) {
          // New PTY. On a reconnect the old one is gone (grace period expired
          // or server restarted): clear the stale screen and re-attach tmux.
          // Same PTY means tmux is still running, so attaching again would
          // type the attach command into the live session.
          if (hadSession) {
            term.clear();
            term.write("\x1b[2J\x1b[H");
          }
          callbacks.onConnected?.({ replacedPty: hadSession });
        }
        if (msg.buffered) {
          // Clear existing terminal content before replaying buffer.
          // The buffer contains raw escape sequences (tmux borders, cursor
          // positioning) that assume a clean terminal state. Writing them
          // on top of existing content produces garbled characters — especially
          // visible after mobile browser minimize/restore cycles.
          //
          // Use clear() + ANSI erase instead of reset() — reset() clears
          // xterm's DA-response flags, causing it to re-answer Device Attributes
          // queries in the replayed buffer, which produces visible garbage
          // like [?1;2c and [>0;276;0c.
          //
          // Even with clear() (not reset()), a fresh xterm instance (new tab
          // load, component remount) hasn't yet answered the DA queries that
          // were in the original live stream, so it auto-responds through
          // onData when it sees them in the replayed buffer — injecting
          // garbage like "[>0;276;0c" as PTY input. Strip DA query sequences
          // from the buffer before replaying to prevent this entirely.
          // Primary DA: ESC [ c or ESC [ 0 c
          // Secondary DA: ESC [ > c or ESC [ > 0 c
          // Strip all DA-related sequences (queries and responses):
          //   \x1b[c, \x1b[0c               — Primary DA query
          //   \x1b[>c, \x1b[>0c             — Secondary DA query
          //   \x1b[=c                        — Tertiary DA query
          //   \x1b[?1;2c                     — Primary DA response
          //   \x1b[>0;276;0c                 — Secondary DA response
          // All follow the pattern: ESC [ [?=>]? digits/semicolons c
          const sanitized = msg.buffered.replace(/\x1b\[[?=>]?[\d;]*c/g, "");
          term.clear();
          term.write("\x1b[2J\x1b[H");
          term.write(sanitized);
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

  function handleClose(event: CloseEvent) {
    clearHandshake();
    clientLog(
      `terminal socket closed ${event.code} after ${Date.now() - connectStartedAt}ms`
    );
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
      try {
        oldWs.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    callbacks.onConnectionStateChange("reconnecting");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;

    // Create fresh connection — include sessionId for PTY reattachment
    const newWs = new WebSocket(buildWsUrl());
    wsRef.current = newWs;
    watchHandshake(newWs);
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

  // Handle terminal input — detect paste vs keyboard heuristically
  term.onData((data) => {
    // Drop Device Attributes responses auto-generated by xterm when it receives
    // DA queries in PTY output. These must never be forwarded to the PTY as
    // keyboard input — they cause garbage like "[?1;2c[>0;276;0c" to appear
    // in the terminal. The buffer sanitizer strips DA queries before replay, but
    // this guard catches any that slip through from live PTY output.
    if (/^\x1b\[[?=>][\d;]*c/.test(data)) return;

    // Any data starting with ESC is a terminal escape sequence (keyboard special
    // keys, F-keys, mouse events encoded by xterm when mouse tracking is active, etc.)
    // — never treat these as pastes regardless of length.
    // Multi-char data without a leading ESC is a native browser paste that bypassed
    // our Cmd+V/right-click interceptors (e.g. Ctrl+V into xterm's hidden textarea).
    if (data.length > 1 && !data.startsWith("\x1b")) {
      sendPaste(data);
    } else {
      sendInput(data);
    }
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
    clientLog(
      `terminal visible after ${Math.round(wasHiddenFor / 1000)}s hidden, socket ${wsRef.current?.readyState ?? "none"}`
    );

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

  // Restored from Safari's back/forward cache, or network came back:
  // the socket is almost certainly dead even if readyState says OPEN
  const handlePageShow = (e: PageTransitionEvent) => {
    if (e.persisted) forceReconnect();
  };
  const handleOnline = () => forceReconnect();
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("online", handleOnline);

  const cleanup = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("online", handleOnline);
    stopClientPing();
    clearHandshake();
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
    sendPaste,
    sendCommand,
    sendResize,
    reconnect: forceReconnect,
    cleanup,
  };
}
