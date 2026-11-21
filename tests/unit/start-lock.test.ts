import { test } from "node:test";
import assert from "node:assert/strict";
import { startLock } from "../../lib/from-machine-rules";

test("starts from one machine run one at a time; other machines don't wait", async () => {
  const order: string[] = [];
  const first = await startLock("m_00000000000a");
  const second = startLock("m_00000000000a").then((release) => {
    order.push("a2");
    release();
  });
  const other = startLock("m_00000000000b").then((release) => {
    order.push("b");
    release();
  });
  await other;
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(order, ["b"]);
  first();
  await second;
  assert.deepEqual(order, ["b", "a2"]);
  // Free again afterwards
  (await startLock("m_00000000000a"))();
});
