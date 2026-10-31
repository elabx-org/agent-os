"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import { WS_RECONNECT_BASE_DELAY } from "../constants";
import type {
  TerminalScrollState,
  UseTerminalConnectionProps,
  UseTerminalConnectionReturn,
} from "./useTerminalConnection.types";
import {
  createTerminal,
  updateTerminalDensity,
  updateTerminalFont,
  updateTerminalTheme,
} from "./terminal-init";
import { setupTouchScroll } from "./touch-scroll";
import { createHistoryLayer, type HistoryLayer } from "./history-layer";
import { setupWheel } from "./wheel";
import { createWebSocketConnection } from "./websocket-connection";
import { setupResizeHandlers } from "./resize-handlers";
import { remeasureWhenFontsReady, terminalFontReady } from "../font-ready";
import { subscribe } from "valtio";
import { DENSITY_EVENT } from "@/lib/display-density";
import { terminalFontStore } from "@/lib/terminal-font";
import { BACKGROUND_EVENT } from "@/lib/background";

export type { TerminalScrollState } from "./useTerminalConnection.types";

export function useTerminalConnection({
  terminalRef,
  onConnected,
  onDisconnected,
  onBeforeUnmount,
  initialScrollState,
  isMobile = false,
  theme = "dark",
  selectMode = false,
  onLongPress,
}: UseTerminalConnectionProps): UseTerminalConnectionReturn {
  const [connected, setConnected] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // The history a swipe back opens over the live terminal (touch-scroll.ts)
  const historyRef = useRef<HistoryLayer | null>(null);
  // Rows the history was scrolled up when a long press opened select mode
  const historyOffsetRef = useRef<number | null>(null);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected" | "reconnecting"
  >("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const reconnectFnRef = useRef<(() => void) | null>(null);

  // Reconnection tracking
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef<number>(WS_RECONNECT_BASE_DELAY);
  const intentionalCloseRef = useRef<boolean>(false);

  // Store callbacks and state in refs
  const callbacksRef = useRef({ onConnected, onDisconnected, onBeforeUnmount });
  callbacksRef.current = { onConnected, onDisconnected, onBeforeUnmount };
  const initialScrollStateRef = useRef(initialScrollState);
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  // Read when the terminal opens; a later change is applied in place below,
  // so it never disposes the terminal and opens a second socket
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  // Select mode opens where the history was being read
  const longPressRef = useRef<(() => void) | undefined>(undefined);
  longPressRef.current = onLongPress
    ? () => {
        historyOffsetRef.current = historyRef.current?.rowsFromBottom() ?? null;
        historyRef.current?.close();
        onLongPressRef.current?.();
      }
    : undefined;

  // Simple callbacks
  const scrollToBottom = useCallback(() => {
    historyRef.current?.close();
    xtermRef.current?.scrollToBottom();
  }, []);

  const copySelection = useCallback(() => {
    const selection = xtermRef.current?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
      return true;
    }
    return false;
  }, []);

  // Typing goes to the live terminal: back to it
  const sendInput = useCallback((data: string) => {
    historyRef.current?.close();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const sendPaste = useCallback((data: string) => {
    historyRef.current?.close();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "paste", data }));
    }
  }, []);

  const sendCommand = useCallback((command: string) => {
    historyRef.current?.close();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", data: command }));
    }
  }, []);

  // A tmux attach or agent launch: the server types it only at the shell's
  // prompt (leave: first out of tmux). False when it didn't
  const sendShellCommand = useCallback(
    (command: string, leave = false): Promise<boolean> => {
      // Another session in this terminal: not this one's history
      historyRef.current?.close();
      return new Promise((resolve) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          resolve(false);
          return;
        }
        const id = Math.random().toString(36).slice(2);
        const timeout = setTimeout(() => {
          ws.removeEventListener("message", handler);
          resolve(false);
        }, 10_000);
        const handler = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "shell-command-result" && msg.id === id) {
              clearTimeout(timeout);
              ws.removeEventListener("message", handler);
              resolve(!!msg.ok);
            }
          } catch {
            /* ignore */
          }
        };
        ws.addEventListener("message", handler);
        ws.send(
          JSON.stringify({ type: "shell-command", data: command, leave, id })
        );
      });
    },
    []
  );

  // Execute a command via WebSocket (bypasses /api/exec which may be blocked
  // by reverse proxy): its whole stdout, null without a socket or answer
  const execRawViaWs = useCallback(
    (command: string): Promise<string | null> => {
      return new Promise((resolve) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          resolve(null);
          return;
        }
        const id = Math.random().toString(36).slice(2);
        const timeout = setTimeout(() => {
          ws.removeEventListener("message", handler);
          resolve(null);
        }, 3000);
        const handler = (event: MessageEvent) => {
          // Only an exec result can be this one's
          if (typeof event.data !== "string" || !event.data.includes(id))
            return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "exec-result" && msg.id === id) {
              clearTimeout(timeout);
              ws.removeEventListener("message", handler);
              resolve(msg.stdout || "");
            }
          } catch {
            /* ignore */
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ type: "exec", command, id }));
      });
    },
    []
  );
  const execViaWs = useCallback(
    async (command: string): Promise<string> =>
      ((await execRawViaWs(command)) ?? "").trim(),
    [execRawViaWs]
  );

  const focus = useCallback(() => xtermRef.current?.focus(), []);

  const getScrollState = useCallback((): TerminalScrollState | null => {
    if (!xtermRef.current || !terminalRef.current) return null;
    const buffer = xtermRef.current.buffer.active;
    const viewport = terminalRef.current.querySelector(
      ".xterm-viewport"
    ) as HTMLElement;
    return {
      scrollTop: viewport?.scrollTop ?? 0,
      cursorY: buffer.cursorY,
      baseY: buffer.baseY,
    };
  }, [terminalRef]);

  const restoreScrollState = useCallback(
    (state: TerminalScrollState) => {
      const viewport = terminalRef.current?.querySelector(
        ".xterm-viewport"
      ) as HTMLElement;
      if (viewport) {
        requestAnimationFrame(() => {
          viewport.scrollTop = state.scrollTop;
        });
      }
    },
    [terminalRef]
  );

  const triggerResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = xtermRef.current;
    if (!fitAddon || !term) return;
    fitAddon.fit();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
      );
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectFnRef.current?.();
  }, []);

  // Main setup effect
  useEffect(() => {
    if (!terminalRef.current) return;

    let cancelled = false;
    // Reset intentional close flag (may be true from previous cleanup)
    intentionalCloseRef.current = false;
    let cleanupTouchScroll: (() => void) | null = null;
    let cleanupResizeHandlers: (() => void) | null = null;
    let cleanupWebSocket: (() => void) | null = null;
    let cleanupTerminal: (() => void) | null = null;
    let cleanupFontWait: (() => void) | null = null;
    let connectTimeout: ReturnType<typeof setTimeout> | undefined;

    const connect = (fontReady: boolean) => {
      if (cancelled || !terminalRef.current) return;

      // Initialize terminal with copy/paste callbacks
      const { term, fitAddon, searchAddon, cleanup } = createTerminal(
        terminalRef.current,
        isMobile,
        themeRef.current,
        {
          onPaste: async () => {
            try {
              const text = await navigator.clipboard?.readText?.();
              if (text && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                  JSON.stringify({ type: "paste", data: text })
                );
              }
            } catch {
              // Clipboard API not available or permission denied
            }
            // Refocus terminal — right-click mousedown is stopped from
            // reaching xterm, and the async clipboard read can steal focus
            term.focus();
          },
          onCopyFallback: async () => {
            const text = await execViaWs("tmux save-buffer - 2>/dev/null");
            if (text) {
              try {
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(text);
                  return;
                }
              } catch {
                /* fall through */
              }
              const textarea = document.createElement("textarea");
              textarea.value = text;
              textarea.style.position = "fixed";
              textarea.style.opacity = "0";
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand("copy");
              document.body.removeChild(textarea);
            }
          },
        }
      );
      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      cleanupTerminal = cleanup;

      // Scroll tracking
      term.onScroll(() => {
        const buffer = term.buffer.active;
        setIsAtBottom(buffer.viewportY >= buffer.baseY);
      });

      // The history a swipe back opens, scrolled on the device
      const history = createHistoryLayer({
        term,
        exec: execRawViaWs,
        onLongPressRef: longPressRef,
      });
      historyRef.current = history;
      // Typed into the terminal (keyboard, keys): back to the live screen
      // (not mouse or focus reports xterm sends for tmux)
      const typed = term.onData((data) => {
        if (!/^\x1b\[(<|M|I$|O$)/.test(data)) history.close();
      });

      // Setup touch scroll
      const cleanupTouch = setupTouchScroll({
        term,
        selectModeRef,
        wsRef,
        onLongPressRef: longPressRef,
        history,
      });
      const cleanupWheel = setupWheel(term, wsRef);
      cleanupTouchScroll = () => {
        cleanupTouch();
        cleanupWheel();
        typed.dispose();
        history.dispose();
        if (historyRef.current === history) historyRef.current = null;
      };

      // Setup WebSocket
      const wsManager = createWebSocketConnection(
        term,
        {
          onConnected: (info) => {
            callbacksRef.current.onConnected?.(info);
            // Restore scroll state after connection
            if (initialScrollStateRef.current && terminalRef.current) {
              setTimeout(() => {
                const viewport = terminalRef.current?.querySelector(
                  ".xterm-viewport"
                ) as HTMLElement;
                if (viewport)
                  viewport.scrollTop = initialScrollStateRef.current!.scrollTop;
              }, 200);
            }
          },
          onDisconnected: () => callbacksRef.current.onDisconnected?.(),
          onConnectionStateChange: setConnectionState,
          onSetConnected: setConnected,
        },
        wsRef,
        reconnectTimeoutRef,
        reconnectDelayRef,
        intentionalCloseRef
      );
      cleanupWebSocket = wsManager.cleanup;
      reconnectFnRef.current = wsManager.reconnect;

      // Setup resize handlers
      cleanupResizeHandlers = setupResizeHandlers({
        term,
        fitAddon,
        containerRef: terminalRef,
        isMobile,
        sendResize: wsManager.sendResize,
      });

      // Opened on the fallback font: measure again once it's in (a hidden
      // terminal refits when shown)
      if (!fontReady) {
        cleanupFontWait = remeasureWhenFontsReady(term, () => {
          if (!term.element?.offsetParent) return;
          fitAddon.fit();
          wsManager.sendResize(term.cols, term.rows);
        });
      }
    };

    // The first fit measures the cells: wait for the terminal font first
    void terminalFontReady().then((fontReady) => {
      if (!cancelled)
        connectTimeout = setTimeout(() => connect(fontReady), 150);
    });

    return () => {
      cancelled = true;
      clearTimeout(connectTimeout);
      cleanupFontWait?.();
      intentionalCloseRef.current = true;

      // Save scroll state before unmount
      const term = xtermRef.current;
      if (term && callbacksRef.current.onBeforeUnmount && terminalRef.current) {
        const buffer = term.buffer.active;
        const viewport = terminalRef.current.querySelector(
          ".xterm-viewport"
        ) as HTMLElement;
        callbacksRef.current.onBeforeUnmount({
          scrollTop: viewport?.scrollTop ?? 0,
          cursorY: buffer.cursorY,
          baseY: buffer.baseY,
        });
      }

      // Cleanup in reverse order
      cleanupResizeHandlers?.();
      cleanupWebSocket?.();
      cleanupTouchScroll?.();
      cleanupTerminal?.();

      // Reset refs
      reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;

      if (wsRef.current) wsRef.current = null;
      if (xtermRef.current) {
        try {
          xtermRef.current.dispose();
        } catch {
          /* ignore */
        }
        xtermRef.current = null;
      }
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [isMobile, terminalRef]);

  // Follow the display's text size: fold/unfold and the A−/A+ control
  useEffect(() => {
    const update = () => {
      const term = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) return;
      updateTerminalDensity(term, fitAddon, (cols, rows) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
    };
    update();
    window.addEventListener(DENSITY_EVENT, update);
    return () => window.removeEventListener(DENSITY_EVENT, update);
  }, [isMobile]);

  // Follow the terminal font (Settings → Display), from any device
  useEffect(
    () =>
      subscribe(terminalFontStore, () => {
        const term = xtermRef.current;
        const fitAddon = fitAddonRef.current;
        if (!term || !fitAddon) return;
        updateTerminalFont(term, fitAddon, (cols, rows) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        });
      }),
    []
  );

  // Handle theme changes dynamically
  useEffect(() => {
    if (xtermRef.current) {
      updateTerminalTheme(xtermRef.current, theme);
    }
  }, [theme]);

  // ...and a new background chosen in Settings → Display
  useEffect(() => {
    const update = () => {
      if (xtermRef.current) updateTerminalTheme(xtermRef.current, theme);
    };
    window.addEventListener(BACKGROUND_EVENT, update);
    return () => window.removeEventListener(BACKGROUND_EVENT, update);
  }, [theme]);

  return {
    connected,
    connectionState,
    isAtBottom,
    xtermRef,
    searchAddonRef,
    scrollToBottom,
    copySelection,
    sendInput,
    sendPaste,
    sendCommand,
    sendShellCommand,
    execViaWs,
    historyOffsetRef,
    focus,
    getScrollState,
    restoreScrollState,
    triggerResize,
    reconnect,
  };
}
