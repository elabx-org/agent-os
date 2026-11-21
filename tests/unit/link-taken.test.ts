import { test } from "node:test";
import assert from "node:assert/strict";
import type { TakenResult, TakenSession } from "../../lib/link/protocol";
import { MACHINE_ID, rig } from "./link-rig";

const until = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never ${what}`);
};

const TAKEN: TakenSession = {
  sessionId: "sess-1",
  takeId: "a".repeat(16),
  at: 2,
  copyAt: 1,
  hubName: "Unraid",
  claudeSessionId: "0b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b",
  transcriptBytes: 10,
  head: null,
  tree: null,
};

test("taken: sent right after welcome, and its ack reaches the hub", async () => {
  const events: string[] = [];
  const acks: TakenResult[][] = [];
  const r = await rig({
    deps: {
      takenFor: (m) => {
        events.push(`takenFor ${m.id}`);
        return [TAKEN];
      },
      onTakenAck: (_m, results) => {
        acks.push(results);
      },
      onMachineBack: (m) => {
        events.push(`back ${m.id}`);
      },
    },
  });
  const c = await r.linked({
    onTaken: async (list) => {
      events.push(`onTaken ${list.length}`);
      return list.map((t) => ({
        sessionId: t.sessionId,
        takeId: t.takeId,
        state: "paused" as const,
        ahead: { conversation: true, code: false },
        folder: "/repos/work",
      }));
    },
  });
  await until(() => acks.length === 1, "acked");
  assert.deepEqual(events, [
    `back ${MACHINE_ID}`,
    `takenFor ${MACHINE_ID}`,
    "onTaken 1",
  ]);
  assert.equal(c.takenSeen, true);
  assert.deepEqual(acks[0], [
    {
      sessionId: "sess-1",
      takeId: "a".repeat(16),
      state: "paused",
      ahead: { conversation: true, code: false },
      folder: "/repos/work",
    },
  ]);
  // Told again while connected (a take-over that just finished)
  r.hub.tellTaken(MACHINE_ID);
  await until(() => acks.length === 2, "acked again");
  c.stop();
  await r.close();
});

test("taken: sent even when there is nothing to pause, so copies may start", async () => {
  const r = await rig({ deps: { takenFor: () => [] } });
  let seen: TakenSession[] | null = null;
  const c = await r.linked({
    onTaken: async (list) => {
      seen = list;
      return [];
    },
  });
  await until(() => seen !== null, "taken");
  assert.deepEqual(seen, []);
  assert.equal(c.takenSeen, true);
  c.stop();
  await r.close();
});

test("taken-ack: a result that isn't well formed is dropped", async () => {
  const acks: TakenResult[][] = [];
  const r = await rig({
    deps: {
      takenFor: () => [TAKEN],
      onTakenAck: (_m, results) => {
        acks.push(results);
      },
    },
  });
  const c = await r.linked({
    onTaken: async () =>
      [
        { sessionId: "sess-1", takeId: "a".repeat(16), state: "paused" },
        { sessionId: "../x", takeId: "a".repeat(16), state: "paused" },
        { sessionId: "sess-2", takeId: "short", state: "paused" },
        { sessionId: "sess-3", takeId: "b".repeat(16), state: "deleted" },
      ] as TakenResult[],
  });
  await until(() => acks.length === 1, "acked");
  assert.deepEqual(
    acks[0].map((a) => a.sessionId),
    ["sess-1"]
  );
  c.stop();
  await r.close();
});
