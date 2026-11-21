import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { CreditReceiver, CreditSender } from "../../lib/link/flow";

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("flow: a body goes in chunks no larger than the chunk size", async () => {
  const sent: Buffer[] = [];
  const sender = new CreditSender({
    send: (c) => sent.push(c),
    buffered: () => 0,
    window: 1000,
    chunk: 100,
  });
  await sender.pipe(Readable.from([Buffer.alloc(250, 1), Buffer.alloc(30, 2)]));
  assert.deepEqual(
    sent.map((c) => c.length),
    [100, 100, 50, 30]
  );
});

test("flow: it stops at the window and goes on with credit", async () => {
  const sent: Buffer[] = [];
  const sender = new CreditSender({
    send: (c) => sent.push(c),
    buffered: () => 0,
    window: 200,
    chunk: 100,
  });
  const done = sender.pipe(Readable.from([Buffer.alloc(500)]));
  await wait(30);
  assert.equal(sent.length, 2);
  assert.equal(sender.unacknowledged, 200);
  sender.credit(100);
  await wait(10);
  assert.equal(sent.length, 3);
  sender.credit(1000);
  await done;
  assert.equal(sent.length, 5);
});

test("flow: it waits while the socket is full, then resumes", async () => {
  let buffered = 10_000;
  const sent: Buffer[] = [];
  const sender = new CreditSender({
    send: (c) => sent.push(c),
    buffered: () => buffered,
    high: 1000,
    chunk: 10,
  });
  const done = sender.pipe(Readable.from([Buffer.alloc(20)]));
  await wait(60);
  assert.equal(sent.length, 0);
  buffered = 0;
  await done;
  assert.equal(sent.length, 2);
});

test("flow: abort stops a waiting body", async () => {
  const sender = new CreditSender({
    send: () => {},
    buffered: () => 0,
    window: 10,
    chunk: 10,
  });
  const done = sender.pipe(Readable.from([Buffer.alloc(100)]));
  await wait(10);
  sender.abort();
  await assert.rejects(done, /aborted/);
});

test("flow: the receiver grants a quarter window at a time and spots an overrun", () => {
  const grants: number[] = [];
  let overrun = 0;
  const receiver = new CreditReceiver({
    window: 400,
    grant: (b) => grants.push(b),
    overrun: () => overrun++,
  });
  receiver.received(100);
  receiver.consumed(60);
  assert.deepEqual(grants, []);
  receiver.consumed(40);
  assert.deepEqual(grants, [100]);
  // Twice the window unacknowledged: the sender ignored it
  receiver.received(800);
  assert.equal(overrun, 0);
  receiver.received(1);
  assert.equal(overrun, 1);
});

test("flow: through a slow sink, unacknowledged bytes stay within the window", async () => {
  const window = 64 * 1024;
  const chunk = 8 * 1024;
  const total = 2 * 1024 * 1024;
  const data = Buffer.alloc(total);
  for (let i = 0; i < total; i++) data[i] = (i * 7) % 251;
  let most = 0;
  const got: Buffer[] = [];
  let sender: CreditSender;
  const receiver = new CreditReceiver({
    window,
    grant: (b) => sender.credit(b),
    overrun: () => assert.fail("overrun"),
  });
  sender = new CreditSender({
    window,
    chunk,
    buffered: () => 0,
    send: (c) => {
      most = Math.max(most, sender.unacknowledged);
      receiver.received(c.length);
      got.push(Buffer.from(c));
      // The sink takes it in a little later
      setImmediate(() => receiver.consumed(c.length));
    },
  });
  await sender.pipe(Readable.from([data]));
  assert.ok(most <= window + chunk, `${most}`);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  assert.equal(hash(Buffer.concat(got)), hash(data));
});
