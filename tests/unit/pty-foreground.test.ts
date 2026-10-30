import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPlainShell,
  leaveKeys,
  parseCmdline,
  parseTpgid,
} from "../../lib/pty-foreground";
import { createPaneData, createTab, splitPane } from "../../lib/panes";

test("parseTpgid reads the foreground group past a command name with spaces", () => {
  const stat =
    "4242 (tmux: client) S 4200 4242 4200 34817 4242 4194560 312 0 0 0";
  assert.equal(parseTpgid(stat), 4242);
  const bash = "4200 (bash) S 1 4200 4200 34817 4200 4194304 900 0 0 0";
  assert.equal(parseTpgid(bash), 4200);
  // No controlling terminal
  assert.equal(parseTpgid("7 (kthreadd) S 2 0 0 0 -1 0"), null);
});

test("parseCmdline splits on NULs", () => {
  assert.deepEqual(parseCmdline("tmux\0attach\0-t\0claude-1\0"), [
    "tmux",
    "attach",
    "-t",
    "claude-1",
  ]);
});

test("isPlainShell knows shells by name, login or path", () => {
  assert.ok(isPlainShell("/bin/bash"));
  assert.ok(isPlainShell("-zsh"));
  assert.ok(isPlainShell("fish"));
  assert.ok(!isPlainShell("tmux"));
  assert.ok(!isPlainShell("claude"));
  assert.ok(!isPlainShell("node"));
});

test("leaveKeys leaves only what AgentOS put there", () => {
  assert.equal(leaveKeys(["tmux", "attach", "-t", "claude-1"]), "\x02d");
  assert.equal(leaveKeys(["/usr/bin/tmux", "new", "-s", "x"]), "\x02d");
  assert.equal(leaveKeys(["tmux: client"]), "\x02d");
  assert.equal(leaveKeys(["tmux"]), "\x02d");
  assert.equal(leaveKeys(["claude", "attach", "abc"]), "\x03");
  // On its way to the attach: waited out, not detached
  assert.equal(leaveKeys(["tmux", "set-option", "-g", "mouse", "on"]), null);
  // An agent or the user's own program stays: nothing is typed into it
  assert.equal(leaveKeys(["claude", "--resume", "x"]), null);
  assert.equal(leaveKeys(["node", "/usr/bin/claude"]), null);
  assert.equal(leaveKeys(["vim", "notes.md"]), null);
  assert.equal(leaveKeys([]), null);
});

test("a tab is a shell only when asked for", () => {
  assert.equal(createTab().shell, undefined);
  assert.equal(createTab(true).shell, true);
  assert.equal(createPaneData().tabs[0].shell, undefined);
  const state = {
    layout: { type: "leaf" as const, paneId: "p1" },
    focusedPaneId: "p1",
    panes: { p1: createPaneData() },
  };
  const beside = splitPane(state, "p1", "horizontal", "p2")!;
  assert.equal(beside.panes.p2.tabs[0].shell, undefined);
  const asked = splitPane(state, "p1", "vertical", "p3", true)!;
  assert.equal(asked.panes.p3.tabs[0].shell, true);
});
