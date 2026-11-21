import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_TAIL,
  TAIL_BYTES,
  conversationRange,
  cutAtNewline,
  tailHash,
} from "../../lib/backup/delta";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-delta-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (name: string, data: string | Buffer) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, data);
  return file;
};
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

test("cutAtNewline: a line still being written is left out", async () => {
  const file = write("a.jsonl", '{"a":1}\n{"b":2}\n{"c":');
  assert.equal(await cutAtNewline(file, fs.statSync(file).size), 16);
  assert.equal(await cutAtNewline(file, 10), 8);
  assert.equal(await cutAtNewline(file, 0), 0);
  assert.equal(await cutAtNewline(write("b.jsonl", "no newline"), 10), 0);
});

test("cutAtNewline: finds a newline far back", async () => {
  const data = Buffer.concat([
    Buffer.from("x\n"),
    Buffer.alloc(200 * 1024, 0x61),
  ]);
  const file = write("c.jsonl", data);
  assert.equal(await cutAtNewline(file, data.length), 2);
});

test("tailHash: at 0, under and over 64 KiB", async () => {
  const small = Buffer.from("hello\n");
  const file = write("d.jsonl", small);
  assert.equal(await tailHash(file, 0), EMPTY_TAIL);
  assert.equal(await tailHash(file, small.length), sha(small));
  const big = Buffer.alloc(TAIL_BYTES + 1000);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  const bigFile = write("e.jsonl", big);
  assert.equal(
    await tailHash(bigFile, big.length),
    sha(big.subarray(big.length - TAIL_BYTES))
  );
  assert.equal(await tailHash(bigFile, 5000), sha(big.subarray(0, 5000)));
});

test("conversationRange: from the hub's end, or all again", () => {
  assert.deepEqual(
    conversationRange({
      length: 100,
      offset: 40,
      hubTail: "t",
      localTail: "t",
    }),
    { from: 40, reset: false }
  );
  // Shorter here than on the hub
  assert.deepEqual(
    conversationRange({
      length: 30,
      offset: 40,
      hubTail: "t",
      localTail: null,
    }),
    { from: 0, reset: true }
  );
  // Rewritten: the bytes differ
  assert.deepEqual(
    conversationRange({
      length: 100,
      offset: 40,
      hubTail: "t",
      localTail: "u",
    }),
    { from: 0, reset: true }
  );
  assert.deepEqual(
    conversationRange({
      length: 10,
      offset: 0,
      hubTail: EMPTY_TAIL,
      localTail: EMPTY_TAIL,
    }),
    { from: 0, reset: false }
  );
});
