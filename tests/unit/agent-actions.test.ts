import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";
import {
  agentActor,
  agentActorSessionId,
  AGENT_ACTOR_HEADER,
  forgetRetried,
  hasAgentMarkers,
  listAgentActions,
  recordAgentAction,
  recordRefusal,
} from "../../lib/agent-actions";

function freshDb() {
  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db);
  const add = db.prepare(
    "INSERT INTO sessions (id, name, tmux_name, agent_type) VALUES (?, ?, ?, ?)"
  );
  add.run("target", "Fix login", "claude-target", "claude");
  add.run("conductor", "Stack health check", "claude-conductor", "claude");
  // tmux_name empty: the default "<agent>-<id>" name still resolves
  add.run("worker", "Worker", "", "codex");
  return db;
}

test("agentActor: the header, only when it looks like a tmux name", () => {
  const req = (value?: string) =>
    new Request("http://localhost/", {
      headers: value === undefined ? {} : { [AGENT_ACTOR_HEADER]: value },
    });
  assert.equal(agentActor(req("claude-abc_1.2:3")), "claude-abc_1.2:3");
  assert.equal(agentActor(req()), null);
  assert.equal(agentActor(req("  ")), null);
  assert.equal(agentActor(req("a b")), null);
  assert.equal(agentActor(req("x".repeat(129))), null);
});

test("record + list: newest first, actor named after its session", () => {
  const db = freshDb();
  recordAgentAction(
    {
      actorTmux: "claude-conductor",
      targetSessionId: "target",
      action: "prompt_answer",
      allowed: false,
      detail: "Yes",
      at: 1000,
    },
    db
  );
  recordAgentAction(
    {
      actorTmux: "codex-worker",
      targetSessionId: "target",
      action: "keys",
      allowed: false,
      detail: "Shift+Tab",
      at: 2000,
    },
    db
  );
  recordAgentAction(
    {
      targetSessionId: "target",
      action: "send_keys",
      allowed: true,
      at: 3000,
    },
    db
  );
  recordAgentAction(
    {
      actorTmux: "claude-gone",
      targetSessionId: "other",
      action: "prompt_answer",
      allowed: true,
      at: 4000,
    },
    db
  );

  assert.deepEqual(listAgentActions("target", 0, db), [
    {
      actor: null,
      actorSessionId: null,
      action: "send_keys",
      allowed: true,
      detail: null,
      at: 3000,
    },
    {
      actor: "Worker",
      actorSessionId: "worker",
      action: "keys",
      allowed: false,
      detail: "Shift+Tab",
      at: 2000,
    },
    {
      actor: "Stack health check",
      actorSessionId: "conductor",
      action: "prompt_answer",
      allowed: false,
      detail: "Yes",
      at: 1000,
    },
  ]);
  // Unknown tmux session: shown by its tmux name
  assert.deepEqual(
    listAgentActions("other", 0, db).map((a) => [a.actor, a.actorSessionId]),
    [["claude-gone", null]]
  );
});

test("list: since is exclusive", () => {
  const db = freshDb();
  for (const at of [1000, 2000, 3000]) {
    recordAgentAction(
      { targetSessionId: "target", action: "keys", allowed: false, at },
      db
    );
  }
  assert.deepEqual(
    listAgentActions("target", 2000, db).map((a) => a.at),
    [3000]
  );
  assert.equal(listAgentActions("target", undefined, db).length, 3);
});

test("record: an explicit actor session wins over the tmux lookup", () => {
  const db = freshDb();
  recordAgentAction(
    {
      actorSessionId: "conductor",
      actorTmux: "codex-worker",
      targetSessionId: "worker",
      action: "spawn",
      allowed: true,
      at: 1,
    },
    db
  );
  assert.equal(
    listAgentActions("worker", 0, db)[0].actor,
    "Stack health check"
  );
});

test("record: long details are cut, rows older than 30 days pruned", () => {
  const db = freshDb();
  const day = 86400_000;
  const now = 100 * day;
  recordAgentAction(
    {
      targetSessionId: "target",
      action: "send_keys",
      allowed: true,
      at: now - 31 * day,
    },
    db
  );
  recordAgentAction(
    {
      targetSessionId: "target",
      action: "send_keys",
      allowed: true,
      detail: "x".repeat(500),
      at: now,
    },
    db
  );
  const actions = listAgentActions("target", 0, db);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].detail?.length, 200);
});

test("record: never throws (the audit must not fail the request)", () => {
  const db = freshDb();
  db.close();
  assert.doesNotThrow(() =>
    recordAgentAction(
      { targetSessionId: "target", action: "keys", allowed: false },
      db
    )
  );
});

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/", { headers });

test("hasAgentMarkers: either header", () => {
  assert.equal(hasAgentMarkers(req()), false);
  assert.equal(hasAgentMarkers(req({ "x-agentos-origin": "Agent" })), true);
  assert.equal(
    hasAgentMarkers(req({ [AGENT_ACTOR_HEADER]: "claude-x" })),
    true
  );
});

test("agentActorSessionId: the actor's session, if it's one of ours", () => {
  const db = freshDb();
  const actor = (tmux: string) =>
    agentActorSessionId(req({ [AGENT_ACTOR_HEADER]: tmux }), db);
  assert.equal(actor("claude-conductor"), "conductor");
  assert.equal(actor("codex-worker"), "worker");
  assert.equal(actor("claude-nobody"), null);
  assert.equal(agentActorSessionId(req(), db), null);
});

test("forgetRetried: drops the user's own refused first try, not an agent's", () => {
  const db = freshDb();
  const row = {
    targetSessionId: "target",
    action: "prompt_answer" as const,
    detail: "Yes",
  };
  // No markers: the user's stale tab, or an agent that left them off
  recordRefusal(req(), row, db);
  recordRefusal(req({ [AGENT_ACTOR_HEADER]: "claude-conductor" }), row, db);
  // Another action and an old one stay
  recordRefusal(req(), { ...row, action: "keys" }, db);
  recordAgentAction({ ...row, allowed: false, at: Date.now() - 60_000 }, db);
  forgetRetried("target", "prompt_answer", db);
  const left = listAgentActions("target", 0, db);
  assert.deepEqual(left.map((a) => [a.action, a.actorSessionId]).sort(), [
    ["keys", null],
    ["prompt_answer", null],
    ["prompt_answer", "conductor"],
  ]);
});
