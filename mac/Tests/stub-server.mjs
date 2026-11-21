// A stand-in for this Mac's AgentOS, for ./test.sh action. It answers the
// routes the app uses with fixtures, hands out a cookie the way user proof
// does, refuses user-only calls without it, and records every request (to
// stub-log.json and GET /__stub/log). Nothing here reaches tmux or a real
// AgentOS.
//
//   node Tests/stub-server.mjs [port]     (default 39011, 127.0.0.1 only)
//
// GET /__stub?mode=normal|403once|403always|offline&prompt=v1|v2|v3|none
//   v1: Yes / Yes, and don't ask again / No, fingerprint f1
//   v2: the same prompt with its options in another order, same fingerprint
//   v3: another prompt, fingerprint f2
//   none: no prompt on screen

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] || 39011);
const logFile = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "build", "stub-log.json");
const FEATURES = ["promptFingerprint", "replyGuard", "askLabels"];
const SESSION = "stub-a";

let mode = "normal";
let promptVariant = "v1";
let refusedOnce = false;
let log = [];

const base = {
  title: "Bash command",
  description: "Create empty file",
  detail: "touch stub.txt",
  question: "Do you want to proceed?",
  selected: 0,
};
const yes = { label: "Yes", kind: "allow" };
const always = { label: "Yes, and don't ask again", kind: "always" };
const no = { label: "No", kind: "deny" };
const numbered = (options) => options.map((o, index) => ({ index, ...o }));
const prompts = {
  v1: { prompt: { ...base, options: numbered([yes, always, no]) }, fingerprint: "f1f1f1f1f1f1f1f1" },
  v2: { prompt: { ...base, options: numbered([no, always, yes]) }, fingerprint: "f1f1f1f1f1f1f1f1" },
  v3: {
    prompt: { ...base, detail: "rm -rf stub", options: numbered([yes, no]) },
    fingerprint: "f2f2f2f2f2f2f2f2",
  },
  none: { prompt: null, fingerprint: null },
};

function save() {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
  } catch {}
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const hasCookie = (req) => /(^|;\s*)agentos_u=stub/.test(req.headers.cookie || "");
const origin = `http://127.0.0.1:${port}`;

function userOnly(req, res) {
  if (mode === "403always") return send(res, 403, { error: "user only" }), false;
  if (mode === "403once" && !refusedOnce) {
    refusedOnce = true;
    return send(res, 403, { error: "user only" }), false;
  }
  if (!hasCookie(req) || req.headers.origin !== origin) {
    return send(res, 403, { error: "user only" }), false;
  }
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (url.pathname === "/__stub") {
      if (url.searchParams.get("mode")) {
        mode = url.searchParams.get("mode");
        refusedOnce = false;
      }
      if (url.searchParams.get("prompt")) promptVariant = url.searchParams.get("prompt");
      if (url.searchParams.get("clear")) log = [];
      save();
      return send(res, 200, { mode, prompt: promptVariant, count: log.length });
    }
    if (url.pathname === "/__stub/log") return send(res, 200, log);

    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {}
    const entry = {
      method: req.method,
      path: url.pathname + url.search,
      body,
      cookie: hasCookie(req),
      origin: req.headers.origin ?? null,
      agentMarker: req.headers["x-agentos-origin"] ?? null,
      navigation: req.headers["upgrade-insecure-requests"] === "1",
      status: 0,
    };
    log.push(entry);
    const reply = (status, json, headers) => {
      entry.status = status;
      save();
      send(res, status, json, headers);
    };
    if (mode === "offline" && !url.pathname.startsWith("/api/build")) {
      entry.status = -1;
      save();
      return req.socket.destroy();
    }

    const p = url.pathname;
    const fresh = prompts[promptVariant] || prompts.none;
    if (p === "/api/build") return reply(200, { id: "stub", version: "0.0.0-stub", stub: true, features: FEATURES });
    if (p === "/api/user-proof") {
      const nav = req.headers["upgrade-insecure-requests"] === "1" && /text\/html/.test(req.headers.accept || "");
      return reply(200, { ok: nav }, nav ? { "set-cookie": "agentos_u=stub; HttpOnly; Path=/; SameSite=Strict" } : {});
    }
    if (p === "/api/sessions" && req.method === "GET") {
      return reply(200, { sessions: [{ id: SESSION, name: "Stub A", project_id: "p1", updated_at: "2026-11-21" }] });
    }
    if (p === "/api/sessions" && req.method === "POST") {
      return reply(201, { session: { id: "stub-new", name: "New" } });
    }
    if (p === "/api/sessions/status") {
      return reply(200, { statuses: { [SESSION]: { status: "waiting", lastLine: "stub" } } });
    }
    if (p === "/api/projects") {
      return reply(200, {
        projects: [
          { id: "p1", name: "Stub project", working_directory: "~/stub", agent_type: "claude", default_model: "sonnet", is_uncategorized: 0 },
          { id: "uncategorized", name: "Uncategorized", working_directory: "~", agent_type: "claude", default_model: "", is_uncategorized: 1 },
        ],
      });
    }
    if (p === "/api/notifications") {
      const at = Date.now();
      return reply(200, {
        items: [{ id: "n1", kind: "needsYou", title: "ignored title", body: "x", sessionId: SESSION, projectName: "Stub project", at }],
      });
    }
    const m = p.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/([a-z-]+)$/);
    if (!m) return reply(404, { error: "not found" });
    const [, , route] = m;
    if (route === "prompt" && req.method === "GET") return reply(200, fresh);
    if (route === "reply-context") {
      return reply(200, { context: { kind: "message", question: null, excerpt: "Done.", choices: null } });
    }
    if (route === "prompt" && req.method === "POST") {
      if (!userOnly(req, res)) return (entry.status = 403), save();
      const option = fresh.prompt?.options[body?.index ?? -1];
      if (!fresh.prompt || !option || option.label !== body?.label || (body?.fingerprint && body.fingerprint !== fresh.fingerprint)) {
        return reply(409, { error: "The prompt changed; check the session", prompt: fresh.prompt, fingerprint: fresh.fingerprint });
      }
      return reply(200, { success: true });
    }
    if (route === "send-keys") {
      if (body?.onlyIfNoPrompt === true && fresh.prompt) {
        return reply(409, { error: "It's asking for permission now. Answer that first.", prompt: true });
      }
      if (!userOnly(req, res)) return (entry.status = 403), save();
      return reply(200, { success: true });
    }
    if (route === "ask") {
      if (!userOnly(req, res)) return (entry.status = 403), save();
      return reply(200, { success: true });
    }
    if (route === "interrupt" || route === "stop") return reply(200, { success: true });
    return reply(404, { error: "not found" });
  });
});

server.listen(port, "127.0.0.1", () => {
  save();
  console.log(`stub listening on ${port}`);
});
