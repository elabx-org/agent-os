import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const scripts = path.resolve(__dirname, "../../scripts");

test("the Mac's shell scripts parse", () => {
  for (const name of [
    "agentos-uninstall.sh",
    "agentos-machine.sh",
    "link-machine.sh",
  ]) {
    execFileSync("bash", ["-n", path.join(scripts, name)]);
  }
});

test("agent-os uninstall is the uninstaller, not the old cmd_uninstall", () => {
  const commands = fs.readFileSync(
    path.join(scripts, "lib", "commands.sh"),
    "utf8"
  );
  assert.doesNotMatch(commands, /cmd_uninstall/);
  const launcher = fs.readFileSync(path.join(scripts, "agent-os"), "utf8");
  assert.match(launcher, /uninstall\).*agentos-uninstall\.sh/);
});

test("the uninstaller never touches Claude's files or the tmux server", () => {
  const text = fs.readFileSync(
    path.join(scripts, "agentos-uninstall.sh"),
    "utf8"
  );
  const code = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(code, /kill-server/);
  assert.doesNotMatch(code, /rm [^\n]*\.claude/);
  assert.doesNotMatch(code, /--force/);
});
