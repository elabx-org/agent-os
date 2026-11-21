import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  MAX_CHAIN,
  chainOf,
  ownDepth,
  parseStartedBy,
  startedByLine,
} from "../../lib/session-started-by";

function db() {
  const d = new Database(":memory:");
  d.exec(
    `CREATE TABLE sessions (id TEXT, tmux_name TEXT, agent_type TEXT, started_by TEXT)`
  );
  d.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?)`).run(
    "s1",
    "claude-s1",
    "claude",
    JSON.stringify({
      machineId: "m_000000000001",
      machine: "Mac",
      depth: 2,
      at: 1,
    })
  );
  d.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?)`).run(
    "s2",
    null,
    "claude",
    null
  );
  return d;
}

const req = (headers: Record<string, string>) =>
  new Request("http://x/", { headers });

test("started_by: parsing", () => {
  assert.equal(parseStartedBy(null), null);
  assert.equal(parseStartedBy("nope"), null);
  assert.equal(parseStartedBy(JSON.stringify({ machine: "x" })), null);
  const by = parseStartedBy(
    JSON.stringify({ machineId: "hub", machine: "Unraid", depth: 1, at: 5 })
  );
  assert.deepEqual(by, {
    machineId: "hub",
    machine: "Unraid",
    depth: 1,
    at: 5,
  });
  assert.equal(startedByLine(by!), "Started by a session on Unraid");
});

test("started_by: the depth comes from the asking session's row", () => {
  const d = db();
  assert.equal(ownDepth(req({ "x-agentos-actor": "claude-s1" }), d), 2);
  // tmux name from the agent type and id
  assert.equal(ownDepth(req({ "x-agentos-actor": "claude-s2" }), d), 0);
  assert.equal(ownDepth(req({}), d), 0);
  assert.equal(
    ownDepth(req({ "x-agentos-actor": "link:m_000000000001" }), d),
    0
  );
  assert.equal(
    ownDepth(req({ "x-agentos-actor": "x'; DROP TABLE sessions;--" }), d),
    0
  );
});

test("started_by: the chain header and the 4th hop", () => {
  assert.equal(chainOf(req({ "x-agentos-chain": "2" })), 2);
  assert.equal(chainOf(req({ "x-agentos-chain": "12" })), null);
  assert.equal(chainOf(req({ "x-agentos-chain": "-1" })), null);
  assert.equal(chainOf(req({})), null);
  // Mac -> hub (1) -> Mac (2) -> hub (3): the next start is refused
  let chain = 0;
  const depths: number[] = [];
  for (let hop = 0; hop < 4; hop++) {
    depths.push(chain + 1);
    chain += 1;
  }
  assert.deepEqual(
    depths.map((d) => d > MAX_CHAIN),
    [false, false, false, true]
  );
});
