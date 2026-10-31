import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { exec } from "child_process";
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { scheduleStoreSync } from "./lib/store-sync";
import { startPushWatcher } from "./lib/push/watcher";
import { startTickers } from "./lib/tickers";
import { issueUserProof } from "./lib/user-proof";
import { registerMcp } from "./lib/register-mcp";
import { proxyRequest, proxyUpgrade } from "./lib/port-proxy";
import { applyOriginGate, originGateRefusesUpgrade } from "./lib/origin-gate";
import {
  isPlainShell,
  leaveKeys,
  parseCmdline,
  parseTpgid,
} from "./lib/pty-foreground";
import {
  authConfig,
  deny,
  handleAuthRoute,
  isAllowed,
  isSameOrigin,
} from "./lib/auth";

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
  shellQueue: Promise<unknown>; // shell commands run one after another
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

const SHELL_LEAVE_MS = 2_000; // for a detached tmux client to exit
const SHELL_WAIT_MS = 3_000; // for a login shell's profile to finish

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What runs in front of the PTY's shell: the shell itself, or a program
// (tmux, an agent) that typed text would reach instead
function foreground(session: PtySession): {
  shell: boolean;
  args: string[];
  pid: number | null;
} {
  const pid = session.pty.pid;
  try {
    const tpgid = parseTpgid(readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (tpgid === pid) return { shell: true, args: [], pid };
    if (tpgid !== null) {
      const cmdline = readFileSync(`/proc/${tpgid}/cmdline`, "utf8");
      return { shell: false, args: parseCmdline(cmdline), pid: tpgid };
    }
  } catch { /* no /proc: by name */ }
  const name = session.pty.process;
  return { shell: isPlainShell(name), args: [name], pid: null };
}

async function waitForShell(session: PtySession, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (!foreground(session).shell) {
    if (Date.now() > until) return false;
    await sleep(50);
  }
  return true;
}

// A typed line has started its client (tmux, claude attach) for good, not
// an attach that fails over to `tmux new`; or it's back at the prompt, not
// just between its setup commands
async function settle(session: PtySession): Promise<void> {
  const until = Date.now() + SHELL_WAIT_MS;
  let started = false;
  let front = foreground(session);
  let since = Date.now();
  while (Date.now() < until) {
    await sleep(20);
    const now = foreground(session);
    if (now.pid !== front.pid) {
      front = now;
      since = Date.now();
    }
    if (!front.shell) started = true;
    const steady = Date.now() - since;
    if (front.shell) {
      if (started && steady > 300) return;
    } else if (leaveKeys(front.args) && steady > 200) {
      return;
    }
  }
}

// Type a tmux attach or agent launch line, but only at the shell's prompt:
// typed into tmux or a running agent it would be the user's prompt. With
// `leave`, first leave tmux or a shown background agent (switching what
// the terminal shows) and clear a half-typed line. Commands queue per PTY,
// so a second can't land in the tmux the first one attached.
function runInShell(
  session: PtySession,
  command: string,
  leave: boolean
): Promise<boolean> {
  const run = async () => {
    const front = foreground(session);
    if (!front.shell) {
      const keys = leaveKeys(front.args);
      if (keys) {
        if (!leave) return false;
        session.pty.write(keys);
        if (!(await waitForShell(session, SHELL_LEAVE_MS))) return false;
      } else if (!(await waitForShell(session, SHELL_WAIT_MS))) {
        return false;
      }
    }
    if (leave) {
      session.pty.write("\x03");
      // The tty drops input queued behind Ctrl+C
      await sleep(50);
      if (!foreground(session).shell) return false;
    }
    session.pty.write(command + "\r");
    return true;
  };
  const result = session.shellQueue.then(run).catch(() => false);
  // The next waits until this one runs (or is done): the shell is still in
  // front just after a line is typed, and a second line would land in the
  // tmux the first one starts
  session.shellQueue = result
    .then(async (typed) => {
      if (typed) await settle(session);
    })
    .catch(() => {});
  return result;
}

function attachSession(
  session: PtySession,
  ws: WebSocket,
  reattached = false
): void {
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
  // reattached=false tells a reconnecting client its old PTY is gone (grace
  // period expired or server restarted), so it must re-run its tmux attach
  ws.send(JSON.stringify({
    type: "session",
    sessionId: session.id,
    buffered: session.buffer,
    reattached,
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
        case "paste":
          // Wrap in bracketed paste markers so tmux/readline/apps
          // know this is pasted text and don't interpret escape chars
          session.pty.write(`\x1b[200~${msg.data}\x1b[201~`);
          break;
        case "resize":
          session.pty.resize(msg.cols, msg.rows);
          break;
        case "command":
          session.pty.write(msg.data + "\r");
          break;
        case "shell-command":
          runInShell(session, String(msg.data), !!msg.leave).then((ok) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "shell-command-result", id: msg.id, ok }));
            }
          });
          break;
        case "ping":
          // Application-level ping from client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
        case "exec":
          if (msg.command && typeof msg.command === "string") {
            // AGENT_OS_TTY names this terminal's tmux client, so commands can
            // target its pane rather than tmux's most recent session
            const env = { ...process.env, AGENT_OS_TTY: (session.pty as { ptsName?: string }).ptsName ?? "" };
            exec(msg.command, { timeout: 5000, shell: "/bin/bash", env }, (err, stdout, stderr) => {
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
      shellQueue: Promise.resolve(),
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

// Fail at startup, not on the first request, when sign-in is half-configured
authConfig();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      const url = new URL(req.url!, "http://localhost");
      if (await proxyRequest(req, res, url, "host")) return;
      if (applyOriginGate(req, res)) return;
      if (await handleAuthRoute(req, res, url)) return;
      if (!isAllowed(req, url.pathname)) {
        deny(req, res);
        return;
      }
      if (await proxyRequest(req, res, url, "path")) return;
      issueUserProof(req, res);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const terminalWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (proxyUpgrade(request, socket, head, "host")) return;
    const parsed = parse(request.url || "", true);
    if (proxyUpgrade(request, socket, head, "path")) return;
    // A terminal runs commands: signed in, and only from our own pages
    if (!isAllowed(request, parsed.pathname || "/") || !isSameOrigin(request) || originGateRefusesUpgrade(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

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
        attachSession(existing, ws, true);
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
    console.log(`> AgentOS ready on http://${hostname}:${port}`);
    scheduleStoreSync();
    startPushWatcher();
    startTickers();
    registerMcp(port).catch(() => {});
  });
});
