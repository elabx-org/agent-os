import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { QueueItem } from "../../lib/queue/types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-dispatch-attach-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let store: typeof import("../../lib/queue/store");
let dispatch: typeof import("../../lib/queue/dispatcher");
let db: typeof import("../../lib/db");

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/queue/store");
  dispatch = await import("../../lib/queue/dispatcher");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().exec("DELETE FROM session_queue");
});

const session = (id: string) =>
  ({ id, agent_type: "claude", permission_pending: null }) as Session;

/** A dispatcher on fakes, with a scripted attachment block */
function harness(block: (item: QueueItem) => Promise<string | null>) {
  const sent: string[] = [];
  const resolved: number[] = [];
  const clock = { now: 1_000_000 };
  const d = dispatch.createDispatcher({
    store: store.queueStore(),
    getSession: (id) => session(id),
    readiness: async () => ({ ready: true, holdReason: null }),
    send: async (_s, text) => {
      sent.push(text);
    },
    queueOn: () => true,
    beforeAgentSend: async () => {},
    now: () => clock.now,
    sleep: () => new Promise((r) => setImmediate(r)),
    attachmentBlock: async (_s, item) => {
      resolved.push(item.id);
      return block(item);
    },
  });
  /** Past the wait for the agent to pick up the last send */
  const later = () => (clock.now += 60_000);
  return { d, sent, resolved, later };
}

const BLOCK = (n: number) =>
  `[AgentOS: attached session "A" , a summary, not its full transcript]\nv${n}\n[AgentOS: end of attached session "A"]`;

describe("dispatcher with attached sessions", () => {
  test("composeText: notice, block, text, files", () => {
    const item = {
      text: "fix it",
      attachments: ["/tmp/a.png"],
      sessions: [{ sessionId: "a" }],
    } as QueueItem;
    assert.equal(
      dispatch.composeText("[n]", item, "[block]"),
      "[n]\n\n[block]\n\nfix it /tmp/a.png"
    );
    // Without a block, as before
    assert.equal(dispatch.composeText("[n]", item), "[n] fix it /tmp/a.png");
    assert.equal(dispatch.composeText(null, item, null), "fix it /tmp/a.png");
  });

  test("the store keeps the sessions through enqueue and edits", () => {
    const a = store.enqueue("s1", {
      text: "one",
      origin: "user",
      sessions: [{ sessionId: "x" }, { sessionId: "y" }],
    });
    assert.deepEqual(a.sessions, [{ sessionId: "x" }, { sessionId: "y" }]);
    store.editItem("s1", a.id, { text: "uno" });
    assert.deepEqual(store.queueStore().getItem("s1", a.id)?.sessions, [
      { sessionId: "x" },
      { sessionId: "y" },
    ]);
    const b = store.enqueue("s1", { text: "two", origin: "user" });
    assert.deepEqual(b.sessions, []);
    const raw = db
      .getDb()
      .prepare(`SELECT sessions FROM session_queue WHERE id = ?`)
      .get(b.id) as { sessions: string | null };
    assert.equal(raw.sessions, null);
  });

  test("typed as notice + block + text + files, exactly once", async () => {
    const h = harness(async () => BLOCK(1));
    store.setUndoNotice("s1", "[AgentOS: the user undid turn 2; a.ts is back]");
    const item = store.enqueue("s1", {
      text: "use it",
      attachments: ["/tmp/x.png"],
      sessions: [{ sessionId: "a" }],
      origin: "user",
    });
    await h.d.service("s1");
    await h.d.service("s1");
    assert.deepEqual(h.sent, [
      `[AgentOS: the user undid turn 2; a.ts is back]\n\n${BLOCK(1)}\n\nuse it /tmp/x.png`,
    ]);
    assert.deepEqual(h.resolved, [item.id]);
    assert.equal(store.queueStore().getItem("s1", item.id)?.status, "sent");
  });

  test("a queued item resolves when it goes, not when queued", async () => {
    let version = 1;
    const h = harness(async () => BLOCK(version));
    store.enqueue("s1", {
      text: "later",
      sessions: [{ sessionId: "a" }],
      origin: "user",
    });
    assert.deepEqual(h.resolved, []);
    version = 2;
    await h.d.service("s1");
    assert.deepEqual(h.sent, [`${BLOCK(2)}\n\nlater`]);
  });

  test("sendNow resolves through the same path", async () => {
    const h = harness(async () => BLOCK(7));
    const result = await h.d.sendOrQueue(
      session("s2"),
      { text: "now", sessions: [{ sessionId: "a" }], sendNow: true },
      "user"
    );
    assert.equal(result.sent, true);
    assert.deepEqual(result.item.sessions, [{ sessionId: "a" }]);
    assert.deepEqual(h.sent, [`${BLOCK(7)}\n\nnow`]);
  });

  test("no sessions, a null block or a command: no block, no resolve", async () => {
    const h = harness(async () => null);
    store.enqueue("s1", { text: "plain", origin: "user" });
    await h.d.service("s1");
    assert.deepEqual(h.resolved, []);
    h.later();
    store.enqueue("s1", {
      text: "nothing left",
      sessions: [{ sessionId: "gone" }],
      origin: "user",
    });
    await h.d.service("s1");
    h.later();
    store.enqueue("s1", {
      text: "/compact",
      kind: "command",
      sessions: [{ sessionId: "a" }],
      origin: "user",
    });
    await h.d.service("s1");
    assert.deepEqual(h.sent, ["plain", "nothing left", "/compact"]);
    assert.equal(h.resolved.length, 1);
  });

  test("a resolve failure fails the item once, nothing typed, notice kept", async () => {
    const h = harness(async () => {
      throw new Error("db locked");
    });
    store.setUndoNotice("s1", "[AgentOS: the user undid turn 4; x is back]");
    const item = store.enqueue("s1", {
      text: "keep me",
      sessions: [{ sessionId: "a" }],
      origin: "user",
    });
    const err = console.error;
    console.error = () => {};
    try {
      await assert.rejects(h.d.service("s1"), /attach the sessions: db locked/);
      await h.d.service("s1");
    } finally {
      console.error = err;
    }
    assert.deepEqual(h.sent, []);
    assert.deepEqual(h.resolved, [item.id]);
    const failed = store.queueStore().getItem("s1", item.id)!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.text, "keep me");
    assert.deepEqual(failed.sessions, [{ sessionId: "a" }]);
    assert.ok(store.getUndoNotice("s1"));
  });
});
