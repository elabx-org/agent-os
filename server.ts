import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { exec, execSync } from "child_process";
import { randomBytes } from "crypto";
import { scheduleStoreSync } from "./lib/store-sync";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3011", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// --- tmux-backed Terminal Session Manager ---
// Each WebSocket terminal gets a tmux session. The PTY runs `tmux attach`.
// On disconnect the PTY dies but the tmux session stays alive.
// On reconnect a new PTY attaches to the same tmux session — full state preserved.
// This survives server restarts too since tmux runs independently.

const PING_INTERVAL_MS = 25_000; // 25s server-side ping
const SESSION_GRACE_MS = 600_000; // 10 min before killing abandoned tmux session
const TMUX_PREFIX = "shell-"; // prefix for direct shell tmux sessions

interface ShellSession {
  tmuxName: string;
  pty: pty.IPty | null;
  ws: WebSocket | null;
  alive: boolean;
  pingInterval: ReturnType<typeof setInterval> | null;
  killTimer: ReturnType<typeof setTimeout> | null;
}

const shellSessions = new Map<string, ShellSession>();

function generateId(): string {
  return randomBytes(8).toString("hex");
}

function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t "${name}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function createTmuxSession(name: string): boolean {
  try {
    const shell = process.env.SHELL || "/bin/bash";
    const home = process.env.HOME || "/config";
    const path = process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/config/.npm-global/bin:/config/.local/bin";
    // Create detached tmux session with correct env
    execSync(
      `SHELL="${shell}" HOME="${home}" USER="${process.env.USER || "abc"}" ` +
      `TERM=xterm-256color COLORTERM=truecolor LANG="${process.env.LANG || "en_US.UTF-8"}" ` +
      `PATH="${path}" ` +
      `tmux new-session -d -s "${name}" -x 80 -y 24`,
      { env: { ...process.env, SHELL: shell, HOME: home, TERM: "xterm-256color", COLORTERM: "truecolor", PATH: path } }
    );
    // Disable status bar for clean terminal experience
    execSync(`tmux set-option -t "${name}" status off`);
    // Set generous scrollback
    execSync(`tmux set-option -t "${name}" history-limit 50000`);
    return true;
  } catch (err) {
    console.error("Failed to create tmux session:", err);
    return false;
  }
}

function spawnTmuxAttach(tmuxName: string, cols: number, rows: number): pty.IPty | null {
  try {
    const ptyProcess = pty.spawn("tmux", ["attach", "-t", tmuxName], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME || "/config",
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        HOME: process.env.HOME || "/config",
        PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/config/.npm-global/bin:/config/.local/bin",
        LANG: process.env.LANG || "en_US.UTF-8",
      },
    });
    return ptyProcess;
  } catch (err) {
    console.error("Failed to attach to tmux session:", err);
    return null;
  }
}

function detachSession(session: ShellSession): void {
  // Stop ping
  if (session.pingInterval) {
    clearInterval(session.pingInterval);
    session.pingInterval = null;
  }

  // Kill the PTY (tmux client), tmux session stays alive
  if (session.pty) {
    try { session.pty.kill(); } catch { /* ignore */ }
    session.pty = null;
  }

  session.ws = null;

  // Start grace timer — kill tmux session if nobody reconnects
  if (!session.killTimer) {
    session.killTimer = setTimeout(() => {
      try { execSync(`tmux kill-session -t "${session.tmuxName}" 2>/dev/null`); } catch { /* ignore */ }
      shellSessions.delete(session.tmuxName);
    }, SESSION_GRACE_MS);
  }
}

function attachSession(session: ShellSession, ws: WebSocket, cols = 80, rows = 24): void {
  // Cancel kill timer
  if (session.killTimer) {
    clearTimeout(session.killTimer);
    session.killTimer = null;
  }

  // Detach previous WebSocket
  if (session.ws && session.ws !== ws) {
    session.ws.onclose = null;
    session.ws.onerror = null;
    session.ws.onmessage = null;
    try { session.ws.close(); } catch { /* ignore */ }
  }

  // Kill previous PTY if any (new attach will take over)
  if (session.pty) {
    try { session.pty.kill(); } catch { /* ignore */ }
    session.pty = null;
  }

  session.ws = ws;

  // Spawn new PTY that attaches to the tmux session
  const ptyProcess = spawnTmuxAttach(session.tmuxName, cols, rows);
  if (!ptyProcess) {
    ws.send(JSON.stringify({ type: "error", message: "Failed to attach to terminal session" }));
    ws.close();
    return;
  }
  session.pty = ptyProcess;

  // Send session ID to client
  ws.send(JSON.stringify({ type: "session", sessionId: session.tmuxName }));

  // Wire PTY output → WebSocket
  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(() => {
    // tmux session was killed or exited
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code: 0 }));
      ws.close();
    }
    if (session.pingInterval) clearInterval(session.pingInterval);
    shellSessions.delete(session.tmuxName);
  });

  // Ping/pong heartbeat
  session.alive = true;
  if (session.pingInterval) clearInterval(session.pingInterval);
  session.pingInterval = setInterval(() => {
    if (!session.alive) {
      ws.terminate();
      return;
    }
    session.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }, PING_INTERVAL_MS);

  ws.on("pong", () => { session.alive = true; });

  // Wire WebSocket messages → PTY
  ws.on("message", (message: Buffer) => {
    try {
      const msg = JSON.parse(message.toString());
      switch (msg.type) {
        case "input":
          session.pty?.write(msg.data);
          break;
        case "resize":
          session.pty?.resize(msg.cols, msg.rows);
          break;
        case "command":
          session.pty?.write(msg.data + "\r");
          break;
        case "ping":
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
        terminalWss.emit("connection", ws, request);
      });
    }
    // Let HMR and other WebSocket connections pass through to Next.js
  });

  terminalWss.on("connection", (ws: WebSocket, request: import("http").IncomingMessage) => {
    const parsed = parse(request.url || "", true);
    const requestedSessionId = parsed.query.sessionId as string | undefined;

    // Try to reattach to an existing tmux session
    if (requestedSessionId) {
      // Check our map first
      let session = shellSessions.get(requestedSessionId);
      if (session && tmuxSessionExists(session.tmuxName)) {
        attachSession(session, ws);
        return;
      }

      // Maybe the tmux session exists but we lost our map (server restarted)
      if (requestedSessionId.startsWith(TMUX_PREFIX) && tmuxSessionExists(requestedSessionId)) {
        session = {
          tmuxName: requestedSessionId,
          pty: null,
          ws: null,
          alive: true,
          pingInterval: null,
          killTimer: null,
        };
        shellSessions.set(requestedSessionId, session);
        attachSession(session, ws);
        return;
      }
    }

    // Create new tmux session
    const tmuxName = `${TMUX_PREFIX}${generateId()}`;
    if (!createTmuxSession(tmuxName)) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to start terminal" }));
      ws.close();
      return;
    }

    const session: ShellSession = {
      tmuxName,
      pty: null,
      ws: null,
      alive: true,
      pingInterval: null,
      killTimer: null,
    };
    shellSessions.set(tmuxName, session);
    attachSession(session, ws);
  });

  server.listen(port, () => {
    console.log(`> Agent-OS ready on http://${hostname}:${port}`);
    scheduleStoreSync();
  });
});
