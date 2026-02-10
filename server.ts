import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { exec } from "child_process";
import { randomBytes } from "crypto";
import { scheduleStoreSync } from "./lib/store-sync";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3011", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// --- PTY Session Manager ---
// Keeps PTY processes alive across WebSocket reconnects so that
// Claude Code (or any long-running CLI) survives network blips.

const PING_INTERVAL_MS = 25_000; // 25s — well under typical 60s proxy timeout
const PONG_TIMEOUT_MS = 10_000; // 10s to respond before we consider it dead
const PTY_GRACE_MS = 300_000; // 5 min grace period after disconnect
const OUTPUT_BUFFER_MAX = 200_000; // ~200KB scrollback buffer per session

interface PtySession {
  id: string;
  pty: pty.IPty;
  ws: WebSocket | null;
  buffer: string; // circular output buffer for replay on reconnect
  killTimer: ReturnType<typeof setTimeout> | null;
  alive: boolean; // pong received tracking
  pingInterval: ReturnType<typeof setInterval> | null;
}

const sessions = new Map<string, PtySession>();

function generateId(): string {
  return randomBytes(12).toString("base64url");
}

function appendToBuffer(session: PtySession, data: string): void {
  session.buffer += data;
  if (session.buffer.length > OUTPUT_BUFFER_MAX) {
    // Keep the most recent output
    session.buffer = session.buffer.slice(-OUTPUT_BUFFER_MAX);
  }
}

function detachSession(session: PtySession): void {
  // Stop ping/pong for this session
  if (session.pingInterval) {
    clearInterval(session.pingInterval);
    session.pingInterval = null;
  }

  session.ws = null;

  // Start grace period timer — PTY stays alive for reconnect
  if (!session.killTimer) {
    session.killTimer = setTimeout(() => {
      try { session.pty.kill(); } catch { /* ignore */ }
      sessions.delete(session.id);
    }, PTY_GRACE_MS);
  }
}

function attachSession(session: PtySession, ws: WebSocket): void {
  // Cancel kill timer — client reconnected
  if (session.killTimer) {
    clearTimeout(session.killTimer);
    session.killTimer = null;
  }

  // Detach previous WebSocket if any
  if (session.ws && session.ws !== ws) {
    session.ws.onclose = null;
    session.ws.onerror = null;
    session.ws.onmessage = null;
    try { session.ws.close(); } catch { /* ignore */ }
  }

  session.ws = ws;

  // Send session ID and buffered output
  ws.send(JSON.stringify({
    type: "session",
    sessionId: session.id,
    buffered: session.buffer,
  }));

  // Start ping/pong heartbeat
  session.alive = true;
  if (session.pingInterval) clearInterval(session.pingInterval);
  session.pingInterval = setInterval(() => {
    if (!session.alive) {
      // No pong received — connection is dead
      ws.terminate();
      return;
    }
    session.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }, PING_INTERVAL_MS);

  ws.on("pong", () => {
    session.alive = true;
  });

  // Wire up message handling
  ws.on("message", (message: Buffer) => {
    try {
      const msg = JSON.parse(message.toString());
      switch (msg.type) {
        case "input":
          session.pty.write(msg.data);
          break;
        case "resize":
          session.pty.resize(msg.cols, msg.rows);
          break;
        case "command":
          session.pty.write(msg.data + "\r");
          break;
        case "ping":
          // Application-level ping from client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
        case "exec":
          if (msg.command && typeof msg.command === "string") {
            exec(msg.command, { timeout: 5000, shell: "/bin/bash" }, (err, stdout, stderr) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "exec-result",
                  id: msg.id,
                  stdout: stdout || "",
                  stderr: stderr || "",
                  error: err ? err.message : null,
                }));
              }
            });
          }
          break;
      }
    } catch (err) {
      console.error("Error parsing message:", err);
    }
  });

  ws.on("close", () => detachSession(session));
  ws.on("error", () => detachSession(session));
}

function createPtySession(ws: WebSocket): PtySession | null {
  try {
    const shell = process.env.SHELL || "/bin/bash";
    const minimalEnv: { [key: string]: string } = {
      PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/config/.npm-global/bin:/config/.local/bin",
      HOME: process.env.HOME || "/config",
      USER: process.env.USER || "abc",
      SHELL: shell,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
    };

    const ptyProcess = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/config",
      env: minimalEnv,
    });

    const session: PtySession = {
      id: generateId(),
      pty: ptyProcess,
      ws: null,
      buffer: "",
      killTimer: null,
      alive: true,
      pingInterval: null,
    };

    // Always buffer PTY output (even during disconnect)
    ptyProcess.onData((data: string) => {
      appendToBuffer(session, data);
      if (session.ws?.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.ws?.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        session.ws.close();
      }
      if (session.pingInterval) clearInterval(session.pingInterval);
      sessions.delete(session.id);
    });

    sessions.set(session.id, session);
    return session;
  } catch (err) {
    console.error("Failed to spawn pty:", err);
    return null;
  }
}

// --- Server setup ---

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const terminalWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const parsed = parse(request.url || "", true);

    if (parsed.pathname === "/ws/terminal") {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        // Pass query params through emit
        terminalWss.emit("connection", ws, request);
      });
    }
    // Let HMR and other WebSocket connections pass through to Next.js
  });

  terminalWss.on("connection", (ws: WebSocket, request: import("http").IncomingMessage) => {
    const parsed = parse(request.url || "", true);
    const requestedSessionId = parsed.query.sessionId as string | undefined;

    // Try to reattach to an existing session
    if (requestedSessionId) {
      const existing = sessions.get(requestedSessionId);
      if (existing) {
        attachSession(existing, ws);
        return;
      }
    }

    // Create new PTY session
    const session = createPtySession(ws);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to start terminal" }));
      ws.close();
      return;
    }

    attachSession(session, ws);
  });

  server.listen(port, () => {
    console.log(`> Agent-OS ready on http://${hostname}:${port}`);
    scheduleStoreSync();
  });
});
