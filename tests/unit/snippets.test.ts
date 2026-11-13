import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SNIPPETS, asSnippets, reconcile } from "../../lib/snippets";

const mine = { id: "1794000000000", name: "Mine", content: "do my thing" };

test("nothing saved anywhere: the defaults become the shared list", () => {
  assert.deepEqual(reconcile(null, null, false), DEFAULT_SNIPPETS);
});

test("the first browser's list is taken, with the newer default added", () => {
  const local = [DEFAULT_SNIPPETS[0], mine];
  const next = reconcile(null, local, false)!;
  assert.deepEqual(next.slice(0, 2), local);
  assert.equal(next[2].id, "default-17");
  assert.equal(next.length, 3);
});

test("a later browser adds only what it made itself", () => {
  const server = [DEFAULT_SNIPPETS[1]];
  // default-1 was deleted on the first device: it stays deleted
  const local = [DEFAULT_SNIPPETS[0], mine];
  assert.deepEqual(reconcile(server, local, false), [...server, mine]);
});

test("nothing to add, or already handed over: the server's list stands", () => {
  const server = [DEFAULT_SNIPPETS[1], mine];
  assert.equal(reconcile(server, [mine], false), null);
  assert.equal(reconcile(server, null, false), null);
  const other = { id: "2", name: "Other", content: "else" };
  assert.equal(reconcile(server, [other], true), null);
});

test("an emptied shared list stays empty", () => {
  assert.equal(reconcile([], null, true), null);
  assert.equal(reconcile([], DEFAULT_SNIPPETS, false), null);
});

test("stored values that aren't snippet lists are refused", () => {
  assert.equal(asSnippets(null), null);
  assert.equal(asSnippets({}), null);
  assert.deepEqual(asSnippets([mine, { id: 1 }, null, "x"]), [mine]);
});
