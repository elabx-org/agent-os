import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stableNodePath } from "../../lib/node-path";

const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "agentos-node-path-"))
);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Homebrew's layout: the real file under the version, a link beside it */
function brew(version: string): { exec: string; linked: string } {
  const bin = path.join(tmp, "Cellar", "node@22", version, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "node"), "");
  const opt = path.join(tmp, "opt");
  fs.mkdirSync(opt, { recursive: true });
  const link = path.join(opt, "node@22");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(path.join(tmp, "Cellar", "node@22", version), link);
  return { exec: path.join(bin, "node"), linked: path.join(link, "bin/node") };
}

test("Homebrew's Node is named by its link, not its version", () => {
  const { exec, linked } = brew("22.23.5_1");
  assert.equal(stableNodePath(exec), linked);
});

test("the name still works after an upgrade removed that version", () => {
  const old = brew("22.23.5_1");
  const now = brew("22.23.5_2");
  fs.rmSync(path.join(tmp, "Cellar", "node@22", "22.23.5_1"), {
    recursive: true,
  });
  // The service still runs the old file; what it hands out has to exist
  const named = stableNodePath(old.exec);
  assert.equal(named, old.linked);
  assert.equal(fs.realpathSync(named), now.exec);
});

test("a Node with no other name keeps its own path", () => {
  assert.equal(stableNodePath(process.execPath), process.execPath);
});

test("one that is gone, with no link to follow, is left to PATH", () => {
  assert.equal(stableNodePath(path.join(tmp, "nowhere", "node")), "node");
});
