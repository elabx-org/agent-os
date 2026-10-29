import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanScript,
  diffChip,
  fileConfig,
  jsonTokens,
  legacyMoved,
  lineDiff,
  listScripts,
  mergeLegacy,
  parseSteps,
  removeScript,
  sameShortcutText,
  scriptId,
  serializeConfig,
  setupSummary,
  stepsLabel,
  upsertScript,
  withDefaults,
} from "@/components/Projects/ProjectConfigText";
import type { AgentOsConfig } from "@/lib/project-config-types";

test("lineDiff marks the lines not on disk", () => {
  const base = '{\n  "a": 1\n}\n';
  const next = '{\n  "a": 1,\n  "b": 2\n}\n';
  const d = lineDiff(base, next);
  assert.deepEqual(
    d.lines.map((l) => l.added),
    [false, true, true, false]
  );
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
});

test("lineDiff: an empty base adds every line; equal texts add none", () => {
  const text = serializeConfig({ previewUrl: "http://localhost:3000" });
  assert.equal(lineDiff("", text).added, 3);
  const same = lineDiff(text, text);
  assert.equal(same.added, 0);
  assert.equal(same.removed, 0);
  assert.equal(lineDiff(text, "").removed, 3);
});

test("lineDiff: an inserted script shows as its own lines only", () => {
  const before: AgentOsConfig = {
    scripts: [
      { id: "dev", name: "Dev", command: "npm run dev" },
      { id: "lint", name: "Lint", command: "npm run lint" },
    ],
  };
  const after = upsertScript(before, {
    id: "test",
    name: "Test",
    command: "npm test",
  });
  const d = lineDiff(serializeConfig(before), serializeConfig(after));
  // The new object (6 lines, `in` spelled out) plus the comma on the line
  // before it; the old objects gain `in` too, as cleanScript writes it
  assert.ok(d.added > 0);
  const added = d.lines.filter((l) => l.added).map((l) => l.text.trim());
  assert.ok(added.includes('"command": "npm test",'));
  assert.ok(!added.includes('"command": "npm run dev"'));
});

test("serializeConfig is 2-space JSON with a final newline", () => {
  assert.equal(serializeConfig({ a: 1 }), '{\n  "a": 1\n}\n');
});

test("jsonTokens splits keys, strings, numbers, literals and punctuation", () => {
  const toks = jsonTokens('  "name": "Test", "n": 3, "on": true');
  const kinds = toks.filter((t) => t.kind).map((t) => [t.kind, t.text]);
  assert.deepEqual(kinds, [
    ["key", '"name"'],
    ["punct", ":"],
    ["string", '"Test"'],
    ["punct", ","],
    ["key", '"n"'],
    ["punct", ":"],
    ["number", "3"],
    ["punct", ","],
    ["key", '"on"'],
    ["punct", ":"],
    ["literal", "true"],
  ]);
  // Every character survives
  assert.equal(
    toks.map((t) => t.text).join(""),
    '  "name": "Test", "n": 3, "on": true'
  );
  assert.equal(
    jsonTokens('"a \\"q\\": b"')
      .map((t) => t.kind)
      .join(),
    "string"
  );
});

test("diffChip", () => {
  assert.equal(diffChip({ added: 3, removed: 0 }), "3 lines to add");
  assert.equal(diffChip({ added: 1, removed: 0 }), "1 line to add");
  assert.equal(
    diffChip({ added: 2, removed: 1 }),
    "2 lines to add · 1 to remove"
  );
  assert.equal(diffChip({ added: 0, removed: 2 }), "2 lines to remove");
  assert.equal(diffChip({ added: 0, removed: 0 }), "");
});

test("fileConfig: empty is {}, a non-object is null, unknown keys kept", () => {
  assert.deepEqual(fileConfig({ text: "" }), {});
  assert.equal(fileConfig({ text: "[1]" }), null);
  assert.equal(fileConfig({ text: "{ nope" }), null);
  assert.deepEqual(fileConfig({ text: '{"custom":{"x":1}}' }), {
    custom: { x: 1 },
  });
});

test("scriptId slugs and stays unique", () => {
  assert.equal(scriptId("Deploy to test server", []), "deploy-to-test-server");
  assert.equal(scriptId("Test", ["test"]), "test-2");
  assert.equal(scriptId("Test", ["test", "test-2"]), "test-3");
  assert.equal(scriptId("!!!", []), "script");
});

test("listScripts gives every script an id and a name", () => {
  const scripts = listScripts({
    scripts: [
      { name: "Test", command: "npm test" } as never,
      { id: "test", name: "Other", command: "x" },
      { command: "make" } as never,
    ],
  });
  assert.deepEqual(
    scripts.map((s) => [s.id, s.name]),
    [
      ["test", "Test"],
      ["test", "Other"],
      ["make", "make"],
    ]
  );
});

test("upsert, replace and remove keep unknown keys", () => {
  const base: AgentOsConfig = {
    custom: true,
    scripts: [{ id: "t", name: "T", command: "npm test", extra: 1 } as never],
  };
  const edited = upsertScript(
    base,
    {
      id: "t",
      name: " Test ",
      command: "npm test -- --watch",
      in: "background",
      extra: 1,
    } as never,
    "t"
  );
  assert.equal(edited.custom, true);
  assert.deepEqual(edited.scripts, [
    {
      id: "t",
      name: "Test",
      command: "npm test -- --watch",
      in: "background",
      extra: 1,
    },
  ]);
  const gone = removeScript(edited, "t");
  assert.deepEqual(gone, { custom: true });
});

test("cleanScript writes in, drops a false onWorktree and empty shortcut", () => {
  assert.deepEqual(
    cleanScript({
      id: "b",
      name: "Build",
      command: "npm run build",
      shortcut: "",
      onWorktree: false,
    }),
    { id: "b", name: "Build", command: "npm run build", in: "terminal" }
  );
});

test("withDefaults merges and drops empties", () => {
  const c = withDefaults({ x: 1 }, { agent: "claude", model: "opus" });
  assert.deepEqual(c.defaults, { agent: "claude", model: "opus" });
  const d = withDefaults(c, { model: undefined });
  assert.deepEqual(d.defaults, { agent: "claude" });
  const e = withDefaults(d, { agent: "" });
  assert.equal("defaults" in e, false);
  assert.equal(e.x, 1);
});

test("mergeLegacy moves setup and devServer; legacyMoved tells", () => {
  const legacy = {
    path: "/r/.agent-os/worktrees.json",
    setup: ["npm install", "cp .env.example .env"],
    devServer: { command: "npm run dev" },
  };
  const file: AgentOsConfig = { previewUrl: "http://localhost:3000" };
  assert.equal(legacyMoved(file, legacy), false);
  const moved = mergeLegacy(file, legacy);
  assert.deepEqual(moved, {
    previewUrl: "http://localhost:3000",
    setup: ["npm install", "cp .env.example .env"],
    devServer: { command: "npm run dev" },
  });
  assert.equal(legacyMoved(moved, legacy), true);
});

test("setup summary and step labels", () => {
  assert.equal(
    setupSummary(["npm install --legacy-peer-deps", "cp .env.example .env"]),
    "After npm install and cp .env.example"
  );
  assert.equal(setupSummary([]), "When the worktree is ready");
  assert.equal(setupSummary(["a", "b", "c", "d"]), "After a, b and 2 more");
  assert.equal(stepsLabel(2), "2 steps");
  assert.equal(stepsLabel(1), "1 step");
  assert.equal(stepsLabel(0), "No steps");
  assert.deepEqual(parseSteps(" npm i \n\n cp a b \n"), ["npm i", "cp a b"]);
});

test("sameShortcutText ignores case, order and spelling of Cmd", () => {
  assert.ok(sameShortcutText("Cmd+Shift+T", "shift+cmd+t"));
  assert.ok(sameShortcutText("Ctrl+Shift+T", "Cmd+Shift+T"));
  assert.ok(!sameShortcutText("Cmd+Shift+T", "Cmd+T"));
});
