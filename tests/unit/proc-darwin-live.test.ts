// The macOS process lookups against real processes: runs only on a Mac
// (the macOS CI job), where there is no /proc
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import * as pty from "node-pty";
import {
  cwds,
  foregroundGroup,
  ps,
  psSync,
  terminalForeground,
} from "../../lib/proc-darwin";
import { listListeningPorts } from "../../lib/listening-ports";

const skip = process.platform !== "darwin" && "macOS only";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(
  read: () => T | Promise<T>,
  ok: (value: T) => boolean,
  ms = 5000
): Promise<T> {
  const end = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < end) {
    await sleep(100);
    value = await read();
  }
  return value;
}

test("ps and lsof: parent, command line, age and folder", { skip }, async () => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "agentos-procs-"))
  );
  const child = spawn("sleep", ["30"], { cwd: dir, stdio: "ignore" });
  try {
    await sleep(200);
    const [row] = psSync([child.pid!]);
    assert.equal(row.pid, child.pid);
    assert.equal(row.ppid, process.pid);
    assert.equal(row.args, "sleep 30");
    assert.ok(row.elapsed !== null && row.elapsed < 60);
    const all = await ps();
    assert.ok(all.some((r) => r.pid === process.pid));
    assert.equal((await cwds([child.pid!])).get(child.pid!), dir);
    // A pid that's gone: no row, no throw
    assert.deepEqual(psSync([999999]), []);
  } finally {
    child.kill("SIGKILL");
  }
});

test("terminalForeground: the shell, then what it runs", { skip }, async () => {
  const term = pty.spawn("/bin/bash", ["--norc", "--noprofile"], {
    cols: 80,
    rows: 24,
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm" },
  });
  try {
    const shell = await until(
      () => terminalForeground(term.pid),
      (f) => !!f?.shell
    );
    assert.deepEqual(shell, { shell: true, args: [], pid: term.pid });
    term.write("sleep 31\r");
    const front = await until(
      () => terminalForeground(term.pid),
      (f) => !!f && !f.shell
    );
    assert.equal(front?.shell, false);
    assert.deepEqual(front?.args, ["sleep", "31"]);
    assert.equal(await foregroundGroup(term.pid), front?.pid);
    term.write("\x03");
    const back = await until(
      () => terminalForeground(term.pid),
      (f) => !!f?.shell
    );
    assert.equal(back?.shell, true);
  } finally {
    term.kill();
  }
});

test("listListeningPorts: lsof finds this process's server", { skip }, async () => {
  const server = http.createServer((_q, s) => s.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    // Past the 2s cache of an earlier call
    await sleep(2100);
    const ports = await listListeningPorts();
    const entry = ports.find((p) => p.port === port);
    assert.ok(entry, `port ${port} in ${JSON.stringify(ports)}`);
    assert.deepEqual(entry.addresses, ["127.0.0.1"]);
    assert.equal(entry.processes[0]?.pid, process.pid);
  } finally {
    server.close();
  }
});
