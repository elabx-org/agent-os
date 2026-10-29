import { test } from "node:test";
import assert from "node:assert/strict";
import { QueueRequestError } from "@/components/Composer/queue-model";
import {
  DirectSendError,
  commentCount,
  deliver,
  oldestFirst,
  sendErrorText,
  type SendRoute,
} from "@/lib/review-send";

function route(over: Partial<SendRoute> = {}) {
  const calls: string[] = [];
  const r: SendRoute = {
    queueEnabled: true,
    queueKnown: true,
    queueSend: async (text) => {
      calls.push(`queue:${text}`);
      return { sent: true };
    },
    direct: async (text) => {
      calls.push(`direct:${text}`);
    },
    ...over,
  };
  return { r, calls };
}

test("deliver goes through the queue while it is on", async () => {
  const { r, calls } = route();
  assert.deepEqual(await deliver("hi", r), { sent: true });
  assert.deepEqual(calls, ["queue:hi"]);
});

test("deliver reports a queued message as not sent", async () => {
  const { r } = route({ queueSend: async () => ({ sent: false }) });
  assert.deepEqual(await deliver("hi", r), { sent: false });
  const q = route({
    queueSend: async () => ({ sent: false, item: { id: 7 } }),
  });
  assert.deepEqual(await deliver("hi", q.r), { sent: false, itemId: 7 });
});

test("deliver tries the queue while its state is unknown", async () => {
  const { r, calls } = route({ queueEnabled: false, queueKnown: false });
  await deliver("hi", r);
  assert.deepEqual(calls, ["queue:hi"]);
});

test("deliver sends directly when the queue is known off", async () => {
  const { r, calls } = route({ queueEnabled: false, queueKnown: true });
  assert.deepEqual(await deliver("hi", r), { sent: true });
  assert.deepEqual(calls, ["direct:hi"]);
});

test("deliver falls back to the direct send when the queue says it's off", async () => {
  const calls: string[] = [];
  const { r } = route({
    queueKnown: false,
    queueSend: async () => {
      throw new QueueRequestError("off", 409, "queue_off");
    },
    direct: async (t) => {
      calls.push(t);
    },
  });
  assert.deepEqual(await deliver("hi", r), { sent: true });
  assert.deepEqual(calls, ["hi"]);
});

test("deliver does not fall back on other queue refusals", async () => {
  const calls: string[] = [];
  const { r } = route({
    queueSend: async () => {
      throw new QueueRequestError(
        "Reload to confirm it's you",
        403,
        "user_only"
      );
    },
    direct: async (t) => {
      calls.push(t);
    },
  });
  await assert.rejects(deliver("hi", r), /Reload to confirm/);
  assert.deepEqual(calls, []);
});

test("sendErrorText words each failure", () => {
  assert.equal(
    sendErrorText(
      new QueueRequestError("Couldn't reach the queue", 500, null),
      "Claude"
    ),
    "Couldn't reach the queue"
  );
  assert.equal(
    sendErrorText(
      new DirectSendError(403, { error: "user_only", reason: "no_proof" }),
      "Claude"
    ),
    "Reload to confirm it's you"
  );
  assert.equal(
    sendErrorText(new DirectSendError(403, { error: "user_only" }), "Claude"),
    "Only you can do this, in AgentOS"
  );
  assert.equal(
    sendErrorText(
      new DirectSendError(500, { error: "Session not found" }),
      "Claude"
    ),
    "Session not found"
  );
  assert.equal(
    sendErrorText(new DirectSendError(502, null), "Codex"),
    "Couldn't send to Codex"
  );
  assert.equal(
    sendErrorText(new TypeError("fetch"), "Claude"),
    "Couldn't send to Claude"
  );
});

test("oldestFirst orders by creation, then id, without mutating", () => {
  const input = [
    { id: 3, createdAt: 20 },
    { id: 2, createdAt: 10 },
    { id: 1, createdAt: 10 },
  ];
  assert.deepEqual(
    oldestFirst(input).map((c) => c.id),
    [1, 2, 3]
  );
  assert.deepEqual(
    input.map((c) => c.id),
    [3, 2, 1]
  );
});

test("commentCount", () => {
  assert.equal(commentCount(1), "1 comment");
  assert.equal(commentCount(2), "2 comments");
});
