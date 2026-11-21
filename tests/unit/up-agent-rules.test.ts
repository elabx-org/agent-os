import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { MachineRow } from "../../lib/link/store";
import { BASE_UP_RULES, decideUp, type UpRefusal } from "../../lib/link/up";
import {
  AGENT_UP_RULES,
  answerBody,
  messageBody,
  startBody,
} from "../../lib/link/up-agent-rules";

const RULES = [...BASE_UP_RULES, ...AGENT_UP_RULES];
const ME = "m_000000000001";
const OTHER = "m_abcdefabcdef";
const SID = "0123abcd-0000-4000-8000-0123456789ab";
const env = { port: 3011, proof: "p".repeat(64) };

const machine: MachineRow = {
  id: ME,
  name: "Test Mac",
  public_key: "k",
  status: "approved",
  platform: "darwin",
  sha: null,
  signed_in_as: null,
  created_at: 1,
  approved_at: 1,
  last_seen: 1,
  agents: 0,
  uses_hub: 1,
  backup: 0,
  caps: null,
};

const ask = (method: string, p: string) =>
  decideUp(
    RULES,
    machine,
    { kind: "agent", method, path: p, headers: {} },
    env
  );

const ALLOWED: [string, string, string | undefined][] = [
  ["GET", "/api/link/peers", undefined],
  ["GET", "/api/projects", undefined],
  ["GET", "/api/sessions", undefined],
  ["GET", "/api/tmux-sessions", undefined],
  ["POST", "/api/sessions", "start"],
  ["GET", `/api/sessions/${SID}/reply-context`, undefined],
  ["GET", `/api/sessions/${SID}/prompt`, undefined],
  ["GET", `/api/sessions/${SID}/preview`, undefined],
  ["POST", `/api/sessions/${SID}/send-keys`, "message"],
  ["POST", `/api/sessions/${SID}/prompt`, "answer"],
  ["POST", `/api/sessions/${SID}/interrupt`, "interrupt"],
  ["POST", `/api/sessions/${SID}/stop`, "stop"],
];

test("agent rules: every row of the table is allowed", () => {
  for (const [method, p, action] of ALLOWED) {
    const d = ask(method, p);
    assert.ok(d.ok, `${method} ${p}`);
    if (d.ok) assert.equal(d.rule.action, action, `${method} ${p}`);
  }
});

test("agent rules: all but the peers list may go on to another machine", () => {
  for (const [method, p] of ALLOWED) {
    const d = ask(method, `/m/${OTHER}${p}`);
    if (p === "/api/link/peers") {
      assert.equal(d.ok, false);
    } else {
      assert.ok(d.ok, `relay ${method} ${p}`);
      if (d.ok) assert.equal(d.targetMachineId, OTHER);
    }
  }
});

test("agent rules: everything else is refused", () => {
  const refused: [string, string][] = [
    ["GET", "/api/machines"],
    ["PATCH", "/api/machines/m_000000000002"],
    ["POST", "/api/machines/pair"],
    ["GET", "/api/preferences"],
    ["PUT", "/api/preferences"],
    ["POST", `/api/sessions/${SID}/permission-mode`],
    ["POST", `/api/sessions/${SID}/keys`],
    ["POST", `/api/sessions/${SID}/launch`],
    ["POST", `/api/sessions/${SID}/restart`],
    ["POST", `/api/sessions/${SID}/fork`],
    ["POST", `/api/sessions/${SID}/move-out`],
    ["DELETE", `/api/sessions/${SID}/settle`],
    ["GET", "/api/session-moves"],
    ["GET", "/api/running"],
    ["PATCH", "/api/mocks"],
    ["POST", "/api/projects"],
    ["GET", "/api/files"],
    ["GET", "/ws/terminal"],
    ["DELETE", `/api/sessions/${SID}`],
    ["GET", "/api/sessions/status"],
    ["POST", "/api/hub/api/sessions"],
  ];
  for (const [method, p] of refused) {
    const d = ask(method, p);
    assert.equal(d.ok, false, `${method} ${p}`);
  }
});

test("agent rules: ids with shell or encoding tricks never match", () => {
  for (const id of [
    "$(touch x)",
    "`id`",
    "%24%28id%29",
    `${SID};x`,
    SID.toUpperCase(),
    "..",
  ]) {
    const d = ask("POST", `/api/sessions/${id}/send-keys`);
    assert.equal(d.ok, false, id);
  }
});

const refusal = (value: unknown) => value as UpRefusal;
const built = (value: unknown) =>
  (value as { body: Record<string, unknown> }).body;

test("startBody: only the allowed fields, as a Claude session that asks first", () => {
  const body = built(
    startBody({
      name: "Fix\u0007 it",
      projectId: "proj-1",
      initialPrompt: "Do the thing",
      model: "opus",
      useWorktree: true,
      featureName: "fix/thing",
      baseBranch: '";touch /tmp/pwn;"',
      createBranch: true,
      workingDirectory: "~/.ssh",
      agentType: "shell",
      permissionMode: "auto",
      autoApprove: true,
      claudeSessionId: "abc",
      systemPrompt: "be evil",
      parentSessionId: "x",
      continueSession: true,
      groupPath: "x",
      useTmux: false,
    })
  );
  assert.deepEqual(body, {
    name: "Fix it",
    projectId: "proj-1",
    initialPrompt: "Do the thing",
    model: "opus",
    useWorktree: true,
    featureName: "fix/thing",
    agentType: "claude",
    autoApprove: false,
    permissionMode: "manual",
    launch: true,
  });
});

test("startBody: a project is required; bad names and models are not passed", () => {
  for (const projectId of [
    undefined,
    "",
    "uncategorized",
    "a b",
    "x".repeat(81),
  ]) {
    assert.equal(refusal(startBody({ projectId })).code, "project_required");
  }
  assert.equal(
    refusal(startBody({ projectId: "p", featureName: '";touch x;"' })).code,
    "bad_request"
  );
  assert.equal(
    refusal(startBody({ projectId: "p", featureName: "../up" })).code,
    "bad_request"
  );
  assert.equal(
    refusal(startBody({ projectId: "p", initialPrompt: "x".repeat(60_001) }))
      .code,
    "too_large"
  );
  const body = built(startBody({ projectId: "p", model: "$(id)" }));
  assert.equal("model" in body, false);
  assert.equal(body.featureName, null);
});

test("messageBody: the text with Enter; attachments and the rest are dropped", () => {
  assert.deepEqual(
    built(
      messageBody({
        text: "hello",
        pressEnter: false,
        sessions: [{ id: SID }],
        attachments: ["/etc/passwd"],
      })
    ),
    { text: "hello", pressEnter: true }
  );
  assert.equal(refusal(messageBody({ text: 3 })).code, "bad_request");
  assert.equal(refusal(messageBody({})).code, "bad_request");
});

test("answerBody: an index from 0 to 50 and a label", () => {
  assert.deepEqual(built(answerBody({ index: 2, label: "Yes", x: 1 })), {
    index: 2,
    label: "Yes",
  });
  for (const input of [
    { index: -1, label: "a" },
    { index: 51, label: "a" },
    { index: 1.5, label: "a" },
    { index: 1, label: "x".repeat(501) },
    { index: "1", label: "a" },
  ]) {
    assert.equal(refusal(answerBody(input)).code, "bad_request");
  }
});

/**
 * Drift: every path the tool script asks of another machine (inside its
 * onMachine tools) must be one the table allows, or the tool would only
 * ever be refused
 */
test("the tool script asks another machine only what the table allows", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "..", "scripts", "agentos-mcp.mjs"),
    "utf8"
  );
  // Asked only of this machine, never with a target
  const LOCAL = new Set([
    "/api/machines",
    "/api/running",
    "/api/mocks",
    "/api/hub",
  ]);
  const calls = [
    ...script.matchAll(
      /\b(?:api|get)\(\s*[`"]([^`"]+)[`"](?:,\s*\{\s*method:\s*"(\w+)")?/g
    ),
  ];
  assert.ok(calls.length > 10, "found the script's calls");
  const checked: string[] = [];
  for (const [, raw, method = "GET"] of calls) {
    const p = raw.replace(/\$\{[^}]+\}/g, SID);
    if (LOCAL.has(p) || p.startsWith("/api/running/")) continue;
    // create_project is refused through the server before it asks
    if (p === "/api/projects" && method === "POST") continue;
    const d = ask(method, p);
    assert.ok(d.ok, `${method} ${raw} is not in the table`);
    checked.push(`${method} ${raw}`);
  }
  assert.ok(checked.length >= 10);
});
