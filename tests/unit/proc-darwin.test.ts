import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEtime,
  parseLsofCwd,
  parsePs,
  splitArgs,
} from "../../lib/proc-darwin";

// `ps -ww -o pid=,ppid=,tpgid=,etime=,args=` as macOS prints it
const PS = `  501     1   501 02-03:04:05 -zsh
 8123   501  8123       00:07 node /Users/me/app/server.js --port 4000
 8124  8123  8123    01:02:03 /opt/homebrew/bin/tmux attach -t claude-abc
  900     1     0       10:00 /usr/libexec/logd
  901     1     0       00:01
not a row
`;

test("parseEtime: [[dd-]hh:]mm:ss to seconds", () => {
  assert.equal(parseEtime("00:07"), 7);
  assert.equal(parseEtime("10:00"), 600);
  assert.equal(parseEtime("01:02:03"), 3723);
  assert.equal(parseEtime("02-03:04:05"), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(parseEtime("  00:07 "), 7);
  assert.equal(parseEtime("7"), null);
  assert.equal(parseEtime(""), null);
});

test("parsePs: pid, ppid, foreground group, age and command line", () => {
  assert.deepEqual(parsePs(PS), [
    { pid: 501, ppid: 1, tpgid: 501, elapsed: 183845, args: "-zsh" },
    {
      pid: 8123,
      ppid: 501,
      tpgid: 8123,
      elapsed: 7,
      args: "node /Users/me/app/server.js --port 4000",
    },
    {
      pid: 8124,
      ppid: 8123,
      tpgid: 8123,
      elapsed: 3723,
      args: "/opt/homebrew/bin/tmux attach -t claude-abc",
    },
    { pid: 900, ppid: 1, tpgid: 0, elapsed: 600, args: "/usr/libexec/logd" },
    { pid: 901, ppid: 1, tpgid: 0, elapsed: 1, args: "" },
  ]);
  assert.deepEqual(parsePs(""), []);
});

test("splitArgs: at runs of spaces", () => {
  assert.deepEqual(splitArgs("tmux  attach -t x"), [
    "tmux",
    "attach",
    "-t",
    "x",
  ]);
  assert.deepEqual(splitArgs(""), []);
});

test("parseLsofCwd: the n line after each p line", () => {
  const text = `p8123
fcwd
n/Users/me/app
p8200
fcwd
n/private/var/folders/xy/T/run dir
`;
  assert.deepEqual(
    [...parseLsofCwd(text)],
    [
      [8123, "/Users/me/app"],
      [8200, "/private/var/folders/xy/T/run dir"],
    ]
  );
  assert.equal(parseLsofCwd("").size, 0);
});
