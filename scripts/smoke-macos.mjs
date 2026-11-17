#!/usr/bin/env node
/**
 * Smoke test of a built AgentOS on the machine it runs on (the macOS CI
 * job): starts `tsx server.ts` on a free port with a throwaway home,
 * database and tmux server, a fake `claude` first on PATH, and checks what
 * differs from Linux: launching a session in tmux, the status, screen and
 * preview routes, send-keys, the /ws/terminal PTY (node-pty) attaching to
 * the session, typing and reading, leaving tmux for the shell, the running
 * servers view (listening ports, owner, stop), the port proxy, the Ctrl+Z
 * resume, then stop and delete.
 *
 *   node scripts/smoke-macos.mjs [artifacts dir]
 *
 * Needs `npm run build` first. Prints PASS/FAIL per check, exits 1 on any
 * failure; the server's log and the panes it saw end up in the artifacts
 * dir (default: the throwaway folder).
 *
 * Isolation: TMUX/TMUX_PANE unset and TMUX_TMPDIR its own, also in the
 * terminals' login profiles (server.ts starts them with a minimal env), so
 * it never reaches another tmux server. Never port 3011.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import WebSocket from "ws";

const run = promisify(execFile);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "agentos-smoke-"))
);
const ARTIFACTS = path.resolve(process.argv[2] || ROOT);
fs.mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// --- the throwaway machine ---------------------------------------------------

const HOME = path.join(ROOT, "home");
const BIN = path.join(ROOT, "bin");
const REPO = path.join(ROOT, "repo");
const TMUX_DIR = path.join(ROOT, "tmux");
for (const dir of [HOME, BIN, REPO, path.join(ROOT, "agent-os"), path.join(ROOT, "claude")]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.mkdirSync(TMUX_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(TMUX_DIR, 0o700);

// A Claude stand-in: a prompt that echoes lines, plus a few commands
const FAKE = `#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");
const { spawn } = require("child_process");
const args = process.argv.slice(2);
const sub = args[0];
if (sub === "--version" || sub === "-v") { console.log("2.1.999 (Claude Code, smoke fake)"); process.exit(0); }
if (sub === "agents") { console.log("[]"); process.exit(0); }
if (sub === "-p" || sub === "--print") { console.log("Fake summary."); process.exit(0); }
if (["mcp", "config", "update", "doctor", "plugin", "plugins", "setup-token", "logs", "stop", "attach"].includes(sub)) process.exit(0);
fs.appendFileSync(${JSON.stringify(path.join(ROOT, "fake-argv.log"))}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), args }) + "\\n");
const say = (text) => process.stdout.write(text + "\\n");
say("FAKE-AGENT READY pid=" + process.pid);
process.stdout.write("> ");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  line = line.trim();
  if (line.startsWith("/serve ")) {
    const port = Number(line.slice(7));
    const child = spawn(process.execPath, ["-e",
      "require('http').createServer((q, s) => s.end('smoke-served')).listen(" + port + ", '127.0.0.1')"],
      { stdio: "ignore" });
    say("SERVING " + port + " pid=" + child.pid);
  } else if (line === "/suspend") {
    say("Claude Code has been suspended. Run \`fg\` to bring Claude Code back.");
    process.kill(process.pid, "SIGSTOP");
    say("FAKE-AGENT RESUMED");
  } else if (line) {
    say("ECHO: " + line);
  }
  process.stdout.write("> ");
});
rl.on("close", () => process.exit(0));
`;
fs.writeFileSync(path.join(BIN, "claude"), FAKE, { mode: 0o755 });

// A git repo to run the session in
const git = (...a) => run("git", a, { cwd: REPO });
await git("init", "-q");
fs.writeFileSync(path.join(REPO, "README.md"), "# smoke\n");
await git("add", "-A");
await git("-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid", "commit", "-qm", "init");

const PORT = Number(process.env.SMOKE_PORT || (await freePort()));
if (PORT === 3011) {
  console.error("smoke: refusing port 3011");
  process.exit(2);
}
const BASE = `http://127.0.0.1:${PORT}`;
const PATH_ = `${BIN}:${process.env.PATH}`;

const env = { ...process.env };
for (const key of [
  "TMUX", "TMUX_PANE", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET",
  "AGENT_OS_PUBLIC_URL", "AUTH_SECRET", "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
  "GH_TOKEN", "GITHUB_TOKEN",
]) delete env[key];
Object.assign(env, {
  PORT: String(PORT),
  DB_PATH: path.join(ROOT, "agent-os.db"),
  HOME,
  AGENT_OS_HOME: path.join(ROOT, "agent-os"),
  CLAUDE_CONFIG_DIR: path.join(ROOT, "claude"),
  TMUX_TMPDIR: TMUX_DIR,
  PATH: PATH_,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  AGENTOS_DISABLE_PUSH: "1",
  AGENTOS_MCP_REGISTER: "0",
  AGENTOS_URL: BASE,
});

// The page's terminals are login shells with a minimal env: keep their tmux
// in the throwaway server too (zsh on macOS, bash elsewhere)
const profile = [
  "unset TMUX TMUX_PANE",
  `export TMUX_TMPDIR='${TMUX_DIR}'`,
  `export PATH='${PATH_}'`,
  "",
].join("\n");
for (const f of [".zprofile", ".zshrc", ".bash_profile", ".bashrc"]) {
  fs.writeFileSync(path.join(HOME, f), profile);
}

const tmux = (...a) => run("tmux", a, { env });

// --- checks ------------------------------------------------------------------

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}${note ? ` (${note})` : ""} [${Date.now() - started}ms]`);
    return true;
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${error?.stack || error}`);
    return false;
  }
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function until(what, read, ok, ms = 15000) {
  const end = Date.now() + ms;
  let value;
  for (;;) {
    try {
      value = await read();
      if (ok(value)) return value;
    } catch (error) {
      value = error;
    }
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}; last: ${String(JSON.stringify(value) ?? value).slice(-1500)}`);
    }
    await sleep(250);
  }
}

let cookie = "";
/** fetch as the user's page: same origin, with the per-boot proof cookie */
async function api(route, init = {}) {
  const res = await fetch(BASE + route, {
    ...init,
    headers: {
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

async function pane(name) {
  const { stdout } = await tmux("capture-pane", "-t", `=${name}:`, "-p", "-S", "-200");
  return stdout;
}

// --- the server --------------------------------------------------------------

const logFile = path.join(ARTIFACTS, "server.log");
const log = fs.openSync(logFile, "a");
const server = spawn(path.join(APP, "node_modules", ".bin", "tsx"), ["server.ts"], {
  cwd: APP,
  env,
  stdio: ["ignore", log, log],
  detached: true,
});
let serverExit = null;
server.on("exit", (code, signal) => {
  serverExit = { code, signal };
});

const created = new Set();
let ws = null;
// Everything the browser terminal received
let output = "";
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "");

async function cleanup() {
  try {
    ws?.terminate();
  } catch {}
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
  for (let i = 0; i < 20 && !serverExit; i++) await sleep(250);
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
  // Only the throwaway server's sessions, by name; it exits once empty
  try {
    const { stdout } = await tmux("list-sessions", "-F", "#{session_name}");
    for (const name of stdout.split("\n").filter(Boolean)) {
      await tmux("kill-session", "-t", `=${name}`).catch(() => {});
    }
  } catch {}
}

process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

console.log(`smoke: ${process.platform} ${os.release()} node ${process.version}`);
console.log(`smoke: root ${ROOT}, port ${PORT}, artifacts ${ARTIFACTS}`);
try {
  const { stdout } = await tmux("-V");
  console.log(`smoke: ${stdout.trim()}, shell ${env.SHELL || "(none)"}`);
} catch {}

let session = null; // { id, tmux }

try {
  const up = await check("server starts and answers /api/sessions", async () => {
    const res = await until(
      "the server",
      async () => {
        if (serverExit) throw new Error(`server exited ${JSON.stringify(serverExit)}`);
        return api("/api/sessions");
      },
      (r) => r?.status === 200,
      120000
    );
    return `${(res.body.sessions ?? res.body).length ?? "?"} sessions`;
  });
  if (!up) throw new Error("no server");

  await check("a page load issues the user-proof cookie", async () => {
    const res = await fetch(BASE + "/", {
      headers: { accept: "text/html", "upgrade-insecure-requests": "1" },
    });
    const set = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const proof = set.map((c) => c.split(";")[0]).find((c) => c.startsWith("agentos_u="));
    assert(res.status === 200, `GET / ${res.status}`);
    assert(proof, `no agentos_u cookie in ${JSON.stringify(set)}`);
    cookie = proof;
  });

  const launched = await check("create + launch a Claude session in tmux", async () => {
    const res = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "smoke",
        agentType: "claude",
        workingDirectory: REPO,
        launch: true,
      }),
    });
    const s = res.body?.session ?? res.body;
    assert(res.status < 300 && s?.id, `POST /api/sessions ${res.status} ${JSON.stringify(res.body)}`);
    const name = s.tmux_name || `claude-${s.id}`;
    session = { id: s.id, tmux: name };
    created.add(name);
    await until("tmux has-session", () => tmux("has-session", "-t", `=${name}`), () => true);
    const screen = await until("the fake agent's prompt", () => pane(name), (t) => t.includes("FAKE-AGENT READY"));
    const argv = fs.readFileSync(path.join(ROOT, "fake-argv.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert(argv.at(-1).cwd === REPO, `agent cwd ${argv.at(-1).cwd}, wanted ${REPO}`);
    return `${name}; ${screen.split("\n").filter(Boolean).length} rows`;
  });

  if (launched) {
    await check("sessions status route lists it", async () => {
      const res = await until(
        "status",
        () => api("/api/sessions/status"),
        (r) => r.status === 200 && JSON.stringify(r.body).includes(session.id)
      );
      const entry = res.body.statuses?.[session.id] ?? res.body.statuses?.[session.tmux];
      return entry ? `status ${entry.status}` : "listed";
    });

    await check("screen and preview routes read the pane", async () => {
      const screen = await api(`/api/sessions/${session.id}/screen`);
      assert(screen.status === 200 && "screen" in screen.body, `screen ${screen.status} ${JSON.stringify(screen.body)}`);
      const preview = await api(`/api/sessions/${session.id}/preview`);
      assert(preview.status === 200 && Array.isArray(preview.body.lines), `preview ${preview.status}`);
      assert(preview.body.lines.join("\n").includes("FAKE-AGENT READY"), `preview: ${preview.body.lines.join("\n")}`);
    });

    await check("send-keys types into the agent", async () => {
      const res = await api(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        body: JSON.stringify({ text: "hello-from-send-keys" }),
      });
      assert(res.status === 200, `send-keys ${res.status} ${JSON.stringify(res.body)}`);
      await until("the echo", () => pane(session.tmux), (t) => t.includes("ECHO: hello-from-send-keys"));
    });

    // --- the browser's terminal ---
    const messages = [];
    const send = (msg) => ws.send(JSON.stringify(msg));
    const reply = (type, id, ms = 15000) =>
      until(`${type} ${id}`, () => messages.find((m) => m.type === type && m.id === id), Boolean, ms);
    const sawOutput = (text, ms) =>
      until(`terminal output "${text}"`, () => output, (o) => o.includes(text), ms).catch((error) => {
        throw new Error(`${error.message.split("; last:")[0]}; the terminal's last lines:\n${plain(output).split("\n").slice(-25).join("\n")}`);
      });

    const wsUp = await check("/ws/terminal opens a PTY (node-pty)", async () => {
      ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal`, {
        headers: { origin: BASE, cookie },
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);
        if (msg.type === "output") output += msg.data;
        if (msg.type === "session" && msg.buffered) output += msg.buffered;
      });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
        ws.once("unexpected-response", (_q, res) => reject(new Error(`upgrade ${res.statusCode}`)));
      });
      const hello = await until("session message", () => messages.find((m) => m.type === "session"), Boolean);
      send({ type: "resize", cols: 120, rows: 40 });
      // The login shell's prompt is up when it echoes a marker back
      await sleep(500);
      send({ type: "input", data: 'echo "pty-$((40+2))-tmuxdir=$TMUX_TMPDIR=$TMUX="\r' });
      // Its tmux must be the throwaway one, or the attach below could reach
      // another tmux server: stop here if the profile didn't take
      await sawOutput(`pty-42-tmuxdir=${TMUX_DIR}==`, 20000);
      return `pty ${hello.sessionId}`;
    });

    if (wsUp) {
      await check("exec: AGENT_OS_TTY names this PTY", async () => {
        send({ type: "exec", id: "e1", command: 'printf "%s" "$AGENT_OS_TTY"' });
        const res = await reply("exec-result", "e1");
        assert(!res.error && res.stdout.startsWith("/dev/"), `exec ${JSON.stringify(res)}`);
        return res.stdout;
      });

      const attached = await check("shell-command attaches the terminal to the session's tmux", async () => {
        send({
          type: "shell-command",
          id: "a1",
          data: `tmux set-option -g mouse on 2>/dev/null; tmux attach -t ${session.tmux} 2>/dev/null || tmux new -s ${session.tmux}`,
          leave: false,
        });
        const res = await reply("shell-command-result", "a1");
        assert(res.ok === true, `shell-command ${JSON.stringify(res)}`);
        await until(
          "a tmux client on the session",
          () => tmux("list-clients", "-t", `=${session.tmux}`, "-F", "#{client_tty}"),
          (r) => r.stdout.trim().length > 0
        );
        await sawOutput("ECHO: hello-from-send-keys");
      });

      if (attached) {
        await check("typing in the terminal reaches the agent", async () => {
          send({ type: "input", data: "typed-over-ws\r" });
          await sawOutput("ECHO: typed-over-ws");
          await until("the echo in the pane", () => pane(session.tmux), (t) => t.includes("ECHO: typed-over-ws"));
        });

        await check("a launch line is not typed into tmux (foreground detection)", async () => {
          send({ type: "shell-command", id: "a2", data: "echo SHOULD-NOT-TYPE", leave: false });
          const res = await reply("shell-command-result", "a2", 20000);
          assert(res.ok === false, `typed into tmux: ${JSON.stringify(res)}`);
          const t = await pane(session.tmux);
          assert(!t.includes("SHOULD-NOT-TYPE"), "the line reached the agent");
        });

        await check("leave: detaches tmux, runs the line at the shell", async () => {
          send({ type: "shell-command", id: "a3", data: "echo back-at-$((1+1))-shell", leave: true });
          const res = await reply("shell-command-result", "a3", 20000);
          assert(res.ok === true, `leave ${JSON.stringify(res)}`);
          await sawOutput("back-at-2-shell");
          const clients = await tmux("list-clients", "-t", `=${session.tmux}`, "-F", "#{client_tty}");
          assert(clients.stdout.trim() === "", `still attached: ${clients.stdout}`);
          assert(!(await pane(session.tmux)).includes("back-at-"), "the line reached the agent");
        });

        // Switching sessions in one terminal does this every time: the
        // attach line typed with leave, from tmux, again and again
        await check("re-attach and leave, five times over", async () => {
          for (let i = 1; i <= 5; i++) {
            const attach = `tmux attach -t ${session.tmux} 2>/dev/null || tmux new -s ${session.tmux}`;
            send({ type: "shell-command", id: `r${i}`, data: attach, leave: true });
            const a = await reply("shell-command-result", `r${i}`, 20000);
            assert(a.ok === true, `attach ${i}: ${JSON.stringify(a)}`);
            await until(
              `client ${i}`,
              () => tmux("list-clients", "-t", `=${session.tmux}`, "-F", "#{client_tty}"),
              (r) => r.stdout.trim().length > 0
            );
            send({ type: "shell-command", id: `l${i}`, data: `echo round-$((${i}*10))-done`, leave: true });
            const l = await reply("shell-command-result", `l${i}`, 20000);
            assert(l.ok === true, `leave ${i}: ${JSON.stringify(l)}`);
            await sawOutput(`round-${i * 10}-done`);
          }
          assert(!(await pane(session.tmux)).includes("round-"), "a line reached the agent");
        });
      }
    }

    // --- what the session runs ---
    const servePort = await freePort();
    let served = null;
    const serving = await check("a server the agent started is listed with its session", async () => {
      const res = await api(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        body: JSON.stringify({ text: `/serve ${servePort}` }),
      });
      assert(res.status === 200, `send-keys ${res.status}`);
      const ports = await until(
        "the port in /api/ports",
        () => api("/api/ports"),
        (r) => r.body?.ports?.some((p) => p.port === servePort)
      );
      const entry = ports.body.ports.find((p) => p.port === servePort);
      assert(entry.processes[0]?.pid > 0, `no process: ${JSON.stringify(entry)}`);
      const running = await until(
        "the server in /api/running",
        () => api("/api/running"),
        (r) => r.body?.servers?.some((s) => s.port === servePort && s.sessionId)
      );
      served = running.body.servers.find((s) => s.port === servePort);
      assert(served.sessionId === session.id, `owner ${served.sessionId}`);
      assert(served.tmux === session.tmux, `tmux ${served.tmux}`);
      assert(served.cwd === REPO, `cwd ${served.cwd}`);
      assert(served.command.includes("smoke-served"), `command ${served.command}`);
      assert(served.startedAt && Math.abs(Date.now() - served.startedAt) < 120000, `startedAt ${served.startedAt}`);
      return `pid ${served.pid} on ${servePort}`;
    });

    if (serving) {
      await check("the port proxy reaches it", async () => {
        const res = await api(`/proxy/${servePort}/`);
        assert(res.status === 200 && res.body === "smoke-served", `proxy ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
      });

      await check("stop from the running view", async () => {
        const res = await api(`/api/running/${served.pid}`, { method: "DELETE" });
        assert(res.status === 200 && res.body.stopped, `DELETE ${res.status} ${JSON.stringify(res.body)}`);
        await until(
          "the port to close",
          () =>
            new Promise((resolve) => {
              const s = net.connect(servePort, "127.0.0.1");
              s.once("connect", () => (s.destroy(), resolve(false)));
              s.once("error", () => resolve(true));
            }),
          (closed) => closed
        );
      });
    }

    await check("Ctrl+Z: a suspended agent is resumed", async () => {
      const res = await api(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        body: JSON.stringify({ text: "/suspend" }),
      });
      assert(res.status === 200, `send-keys ${res.status}`);
      await until("the suspend notice", () => pane(session.tmux), (t) => t.includes("has been suspended"));
      // The status poll sees the notice and sends SIGCONT
      await until(
        "the agent to resume",
        async () => {
          await api("/api/sessions/status");
          return pane(session.tmux);
        },
        (t) => t.includes("FAKE-AGENT RESUMED"),
        30000
      );
    });

    await check("the agent still answers after all that", async () => {
      await api(`/api/sessions/${session.id}/send-keys`, {
        method: "POST",
        body: JSON.stringify({ text: "still-alive" }),
      });
      await until("the echo", () => pane(session.tmux), (t) => t.includes("ECHO: still-alive"));
    });

    await check("stop ends the session's tmux; delete removes it", async () => {
      fs.writeFileSync(path.join(ARTIFACTS, "pane.txt"), await pane(session.tmux).catch((e) => String(e)));
      const stop = await api(`/api/sessions/${session.id}/stop`, { method: "POST" });
      assert(stop.status === 200 && stop.body.stopped === true, `stop ${stop.status} ${JSON.stringify(stop.body)}`);
      await until(
        "tmux session gone",
        () => tmux("has-session", "-t", `=${session.tmux}`).then(() => false, () => true),
        Boolean
      );
      const del = await api(`/api/sessions/${session.id}`, { method: "DELETE" });
      assert(del.status < 300, `delete ${del.status} ${JSON.stringify(del.body)}`);
      const list = await api("/api/sessions");
      assert(!JSON.stringify(list.body).includes(session.id), "still listed");
    });
  }
} catch (error) {
  console.log(`smoke: aborted: ${error?.stack || error}`);
  results.push({ name: "aborted", ok: false });
} finally {
  fs.writeFileSync(path.join(ARTIFACTS, "terminal.txt"), output);
  await cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nsmoke: ${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join(", ")}` : ""}`);
if (failed.length) {
  console.log(`smoke: server log tail (${logFile}):`);
  console.log(fs.readFileSync(logFile, "utf8").split("\n").slice(-80).join("\n"));
}
process.exit(failed.length ? 1 : 0);
