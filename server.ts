import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { ClaudeProcessManager } from "./lib/claude/process-manager";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3011", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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

  // Terminal WebSocket server
  const terminalWss = new WebSocketServer({ noServer: true });

  // Claude chat WebSocket server
  const claudeWss = new WebSocketServer({ noServer: true });
  const claudeManager = new ClaudeProcessManager();

  // Handle WebSocket upgrades
  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url || "");

    if (pathname === "/ws/terminal") {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit("connection", ws, request);
      });
    } else if (pathname?.startsWith("/ws/claude/")) {
      const sessionId = pathname.split("/ws/claude/")[1];
      if (!sessionId) {
        socket.destroy();
        return;
      }
      claudeWss.handleUpgrade(request, socket, head, (ws) => {
        claudeManager.registerClient(sessionId, ws);

        ws.on("message", (message: Buffer) => {
          try {
            const msg = JSON.parse(message.toString());
            if (msg.type === "prompt") {
              claudeManager.sendPrompt(sessionId, msg.prompt, msg.options || {}).catch((err) => {
                ws.send(JSON.stringify({
                  type: "error",
                  sessionId,
                  timestamp: new Date().toISOString(),
                  data: { error: err.message },
                }));
              });
            } else if (msg.type === "cancel") {
              claudeManager.cancelSession(sessionId);
            }
          } catch (err) {
            console.error("Error parsing claude message:", err);
          }
        });

        ws.on("close", () => {
          claudeManager.unregisterClient(sessionId, ws);
        });
      });
    }
    // Let HMR and other WebSocket connections pass through to Next.js
  });

  // Terminal connections
  terminalWss.on("connection", (ws: WebSocket) => {
    let ptyProcess: pty.IPty;
    try {
      const shell = process.env.SHELL || "/bin/bash";
      // Use minimal env - only essentials for shell to work
      // This lets Next.js/Vite/etc load .env.local without interference from parent process env
      const minimalEnv: { [key: string]: string } = {
        PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/config/.npm-global/bin:/config/.local/bin",
        HOME: process.env.HOME || "/config",
        USER: process.env.USER || "abc",
        SHELL: shell,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: process.env.LANG || "en_US.UTF-8",
      };

      ptyProcess = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || "/config",
        env: minimalEnv,
      });
    } catch (err) {
      console.error("Failed to spawn pty:", err);
      ws.send(
        JSON.stringify({ type: "error", message: "Failed to start terminal" })
      );
      ws.close();
      return;
    }

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
    });

    ws.on("message", (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString());
        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
            break;
          case "resize":
            ptyProcess.resize(msg.cols, msg.rows);
            break;
          case "command":
            ptyProcess.write(msg.data + "\r");
            break;
        }
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    });

    ws.on("close", () => {
      setTimeout(() => { try { ptyProcess.kill(); } catch(e) {} }, 300000);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      setTimeout(() => { try { ptyProcess.kill(); } catch(e) {} }, 300000);
    });
  });

  server.listen(port, () => {
    console.log(`> Agent-OS ready on http://${hostname}:${port}`);
  });
});
