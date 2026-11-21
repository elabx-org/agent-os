import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";

// lib/db reads DB_PATH when it loads, so the env is set before the import.
// Nothing here reaches tmux: every request is answered before it would
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-from-machine-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
process.env.AGENTOS_DISABLE_PUSH = "1";

let db: typeof import("../../lib/db");
let sessions: typeof import("../../app/api/sessions/route");
let sendKeys: typeof import("../../app/api/sessions/[id]/send-keys/route");
let prompt: typeof import("../../app/api/sessions/[id]/prompt/route");
let interrupt: typeof import("../../app/api/sessions/[id]/interrupt/route");
let stop: typeof import("../../app/api/sessions/[id]/stop/route");
let rules: typeof import("../../lib/from-machine-rules");
let projectId = "";
const folder = path.join(tmp, "repo");

before(async () => {
  db = await import("../../lib/db");
  sessions = await import("../../app/api/sessions/route");
  sendKeys = await import("../../app/api/sessions/[id]/send-keys/route");
  prompt = await import("../../app/api/sessions/[id]/prompt/route");
  interrupt = await import("../../app/api/sessions/[id]/interrupt/route");
  stop = await import("../../app/api/sessions/[id]/stop/route");
  rules = await import("../../lib/from-machine-rules");
  fs.mkdirSync(folder, { recursive: true });
  const { createProject } = await import("../../lib/projects");
  projectId = createProject({
    name: "Repo",
    workingDirectory: folder,
    agentType: "shell",
  }).id;
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A machine id of its own per start: the running count reads tmux otherwise */
const nextMachine = () => `m_${String(++n).padStart(12, "0")}`;

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  new Request(`http://127.0.0.1:3011${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;

const row = (id: string) =>
  db.queries.getSession(db.getDb()).get(id) as Session;

function insertSession(over: Partial<Session> & { id: string }) {
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, agent_type, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      over.id,
      over.name ?? over.id,
      null,
      folder,
      over.agent_type ?? "claude",
      projectId
    );
  for (const [key, value] of Object.entries(over)) {
    if (["id", "name", "agent_type"].includes(key)) continue;
    db.getDb()
      .prepare(`UPDATE sessions SET ${key} = ? WHERE id = ?`)
      .run(value, over.id);
  }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

test("from a machine: a Claude session that asks first, in the project's folder", async () => {
  const from = nextMachine();
  const res = await sessions.POST(
    post(
      "/api/sessions",
      {
        projectId,
        name: "From the Mac",
        agentType: "shell",
        permissionMode: "bypassPermissions",
        autoApprove: true,
        workingDirectory: "~/.ssh",
        createBranch: true,
        featureName: '";touch /tmp/pwn;"',
        baseBranch: '";touch /tmp/pwn;"',
        claudeSessionId: "abc",
        systemPrompt: "x",
        parentSessionId: "y",
        launch: false,
      },
      {
        "x-agentos-from-machine": from,
        "x-agentos-origin": "agent",
        "x-agentos-chain": "0",
      }
    )
  );
  assert.equal(res.status, 201);
  const { session } = (await res.json()) as { session: Session };
  const s = row(session.id);
  assert.equal(s.agent_type, "claude");
  assert.equal(s.permission_mode, "manual");
  assert.equal(Number(s.auto_approve), 0);
  assert.equal(s.working_directory, folder);
  assert.equal(s.branch_name, null);
  assert.equal(s.claude_session_id, null);
  assert.equal(s.system_prompt, null);
  assert.equal(s.parent_session_id, null);
  const by = JSON.parse(s.started_by!);
  assert.equal(by.machineId, from);
  assert.equal(by.depth, 1);
  assert.equal(by.machine, "another machine");
});

test("from a machine without a chain header: still marked, so the running cap counts it", async () => {
  const from = nextMachine();
  const res = await sessions.POST(
    post(
      "/api/sessions",
      { projectId, name: "No chain", launch: false },
      { "x-agentos-from-machine": from, "x-agentos-origin": "agent" }
    )
  );
  assert.equal(res.status, 201);
  const { session } = (await res.json()) as { session: Session };
  const by = JSON.parse(row(session.id).started_by!);
  assert.equal(by.machineId, from);
  assert.equal(by.depth, 1);
});

test("from a machine: a project is required, and a branch name must be plain", async () => {
  const from = nextMachine();
  const headers = {
    "x-agentos-from-machine": from,
    "x-agentos-origin": "agent",
  };
  for (const id of [undefined, "uncategorized", "nope"]) {
    const res = await sessions.POST(
      post("/api/sessions", { projectId: id }, headers)
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "project_required");
  }
  const bad = await sessions.POST(
    post(
      "/api/sessions",
      { projectId, useWorktree: true, featureName: '";touch x;"' },
      headers
    )
  );
  assert.equal(bad.status, 400);
});

test("the chain: the 4th start in a row is refused", async () => {
  const res = await sessions.POST(
    post(
      "/api/sessions",
      { projectId, launch: false },
      { "x-agentos-from-machine": nextMachine(), "x-agentos-chain": "3" }
    )
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, "chain_too_deep");
  assert.match(body.error, /3 times in a row/);
  // From a session here, through the link: started_by names the server
  const ok = await sessions.POST(
    post(
      "/api/sessions",
      { projectId, agentType: "claude", launch: false },
      { "x-agentos-chain": "2" }
    )
  );
  assert.equal(ok.status, 201);
  const by = JSON.parse(row((await ok.json()).session.id).started_by!);
  assert.equal(by.machineId, "hub");
  assert.equal(by.depth, 3);
});

test("without the header: the request is taken as it is today", async () => {
  const res = await sessions.POST(
    post("/api/sessions", {
      projectId,
      agentType: "shell",
      workingDirectory: tmp,
      launch: false,
    })
  );
  assert.equal(res.status, 201);
  const s = row((await res.json()).session.id);
  assert.equal(s.agent_type, "shell");
  assert.equal(s.working_directory, tmp);
  assert.equal(s.started_by, null);
});

test("from a machine: shell sessions can't be messaged, answered, interrupted or stopped", async () => {
  insertSession({ id: "shell-1", agent_type: "shell" });
  const headers = {
    "x-agentos-from-machine": nextMachine(),
    "x-agentos-origin": "agent",
  };
  const calls = [
    sendKeys.POST(
      post("/api/sessions/shell-1/send-keys", { text: "hi" }, headers),
      params("shell-1")
    ),
    prompt.POST(
      post("/api/sessions/shell-1/prompt", { index: 0, label: "x" }, headers),
      params("shell-1")
    ),
    interrupt.POST(
      post("/api/sessions/shell-1/interrupt", {}, headers),
      params("shell-1")
    ),
    stop.POST(
      post("/api/sessions/shell-1/stop", {}, headers),
      params("shell-1")
    ),
  ];
  for (const res of await Promise.all(calls)) {
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "claude_only");
  }
});

test("a session that went on to another machine says where, to every caller", async () => {
  insertSession({
    id: "moved-1",
    settled_at: 5,
    moved_to: JSON.stringify({
      machine: "m_abcdefabcdef",
      name: "Mac Studio",
      at: 5,
      head: "x",
      snapshot: null,
    }),
  });
  const res = await sendKeys.POST(
    post("/api/sessions/moved-1/send-keys", { text: "hi" }),
    params("moved-1")
  );
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    code: "moved",
    machine: "m_abcdefabcdef",
    name: "Mac Studio",
    error: "It continues on Mac Studio.",
  });
});

test("messages from a machine: plain text, to sessions that ask first", () => {
  const session = (mode: string | null, auto = false) =>
    ({
      agent_type: "claude",
      permission_mode: mode,
      auto_approve: auto,
    }) as Session;
  const manual = session("manual");
  assert.equal(rules.messageRefusal(manual, "please fix the build"), null);
  assert.equal(rules.messageRefusal(manual, "line one\nline two"), null);
  for (const text of [
    "!ls",
    "  /clear",
    "#remember this",
    "a\u001b[A",
    "tab\there",
    "x\r",
  ]) {
    assert.equal(
      rules.messageRefusal(manual, text),
      "plain_text_only",
      JSON.stringify(text)
    );
  }
  for (const mode of ["acceptEdits", "auto", "bypassPermissions"]) {
    assert.equal(
      rules.messageRefusal(session(mode), "hello"),
      "asks_first_only",
      mode
    );
  }
  assert.equal(
    rules.messageRefusal(session(null, true), "hello"),
    "asks_first_only"
  );
});

test("running from a machine: only its own sessions that still run", async () => {
  const mine = (id: string, machineId: string) =>
    ({
      id,
      started_by: JSON.stringify({ machineId, machine: "M", depth: 1, at: 1 }),
    }) as Session;
  const list = [
    mine("a", "m_1"),
    mine("b", "m_1"),
    mine("c", "m_2"),
    { id: "d", started_by: null } as Session,
  ];
  const live = new Set(["a", "c", "d"]);
  assert.equal(
    await rules.runningFrom("m_1", list, async (s) => live.has(s.id)),
    1
  );
});
