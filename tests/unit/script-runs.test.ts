import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/db reads DB_PATH and lib/dev-servers HOME when they load
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-scripts-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.HOME = path.join(tmp, "home");
process.env.AGENT_OS_HOME = path.join(tmp, "home", ".agent-os");
fs.mkdirSync(process.env.AGENT_OS_HOME, { recursive: true });

let runs: typeof import("../../lib/script-runs");
let dbm: typeof import("../../lib/db");

before(async () => {
  runs = await import("../../lib/script-runs");
  dbm = await import("../../lib/db");
  const log = console.log;
  console.log = () => {};
  try {
    dbm.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cwd = fs.mkdtempSync(path.join(tmp, "cwd-"));
const P = "project-a";

const script = (id: string, command: string, extra = {}) => ({
  id,
  name: id,
  command,
  in: "background" as const,
  ...extra,
});

/** Polls until the run leaves "running" (in-process exit or reconcile) */
async function settled(runId: string, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await runs.reconcileRuns(P);
    const run = runs.getScriptRun(runId);
    if (run && run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} still running`);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("pure helpers", () => {
  test("shellQuote and the terminal line", () => {
    assert.equal(runs.shellQuote("a'b"), `'a'\\''b'`);
    const line = runs.terminalCommand("npm test", "sr_x");
    assert.ok(line.startsWith("npm test; printf %s $? > '"));
    assert.ok(line.endsWith(`sr_x.exit'`));
    assert.equal(runs.isRunId("sr_abc123"), true);
    assert.equal(runs.isRunId("../etc"), false);
  });
});

describe("background runs", () => {
  test("a passing command: passed, exit 0, log kept", async () => {
    const { runId, in: where } = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("ok", "echo hello from $PWD; exit 0"),
    });
    assert.equal(where, "background");
    assert.match(runId, /^sr_[a-z0-9]+$/);
    const run = await settled(runId);
    assert.equal(run.status, "passed");
    assert.equal(run.exit_code, 0);
    assert.ok(run.pid && run.pid > 0);
    assert.ok(run.finished_at! >= run.started_at);
    assert.equal(
      run.log_path,
      path.join(process.env.HOME!, ".agent-os", "logs", `script-${runId}.log`)
    );
    const lines = await runs.readRunLog(runId, 10);
    assert.deepEqual(lines, [
      "$ echo hello from $PWD; exit 0",
      `hello from ${cwd}`,
    ]);
    assert.deepEqual(await runs.readRunLog(runId, 1), [`hello from ${cwd}`]);
  });

  test("a failing command: failed with its exit code", async () => {
    const { runId } = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("bad", "echo oops >&2; exit 3"),
    });
    const run = await settled(runId);
    assert.equal(run.status, "failed");
    assert.equal(run.exit_code, 3);
    assert.ok((await runs.readRunLog(runId)).includes("oops"));
  });

  test("a terminal script without a session runs in the background", async () => {
    const {
      in: where,
      shellCommand,
      runId,
    } = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("term", "true", { in: "terminal" }),
    });
    assert.equal(where, "background");
    assert.equal(shellCommand, undefined);
    await settled(runId);
  });

  test("stop kills the whole process group", async () => {
    const { runId } = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("long", "sleep 30 & sleep 30; wait"),
    });
    await new Promise((r) => setTimeout(r, 300));
    const pid = runs.getScriptRun(runId)!.pid!;
    assert.ok(alive(pid));
    const stopped = await runs.stopScriptRun(runId);
    assert.equal(stopped?.status, "stopped");
    const until = Date.now() + 3000;
    while (alive(pid) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(alive(pid), false);
    // No background sleep left in the group
    const left = execFileSync("ps", ["-eo", "pgid=,comm="], {
      encoding: "utf-8",
    })
      .split("\n")
      .filter((l) => l.trim().startsWith(`${pid} `));
    assert.deepEqual(left, []);
    // The exit event doesn't turn it back into failed
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(runs.getScriptRun(runId)?.status, "stopped");
  });

  test("a missing folder is refused before anything runs", async () => {
    await assert.rejects(
      runs.startScriptRun({
        projectId: P,
        cwd: path.join(tmp, "nope"),
        script: script("ghost", "true"),
      }),
      /Folder not found/
    );
  });
});

describe("terminal runs", () => {
  test("the shell line writes the exit code that reconcile reads", async () => {
    const res = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("t", "true", { in: "terminal" }),
      sessionId: "session-1",
    });
    assert.equal(res.in, "terminal");
    const row = runs.getScriptRun(res.runId)!;
    assert.equal(row.status, "running");
    assert.equal(row.log_path, null);
    assert.equal(row.pid, null);
    assert.deepEqual(await runs.readRunLog(res.runId), []);

    // What the shell drawer does with the line
    execFileSync("bash", ["-c", res.shellCommand!]);
    const failing = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("t2", "false", { in: "terminal" }),
      sessionId: "session-1",
    });
    execFileSync("bash", ["-c", failing.shellCommand!]);

    await runs.reconcileRuns(P);
    assert.equal(runs.getScriptRun(res.runId)?.status, "passed");
    const failed = runs.getScriptRun(failing.runId)!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.exit_code, 1);
  });
});

describe("reconcile and last runs", () => {
  test("a dead pid without an exit file is failed", async () => {
    const pid = Number(
      execFileSync("bash", ["-c", "echo $$"], { encoding: "utf-8" }).trim()
    );
    dbm
      .getDb()
      .prepare(
        `INSERT INTO script_runs (id, project_id, script_id, command, status, pid, log_path, started_at)
         VALUES ('sr_dead', ?, 'dead', 'x', 'running', ?, '/nonexistent', ?)`
      )
      .run(P, pid, Date.now());
    await runs.reconcileRuns(P);
    assert.equal(runs.getScriptRun("sr_dead")?.status, "failed");
  });

  test("lastRunsByScript gives the newest run of each script", async () => {
    const first = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("twice", "exit 1"),
    });
    await settled(first.runId);
    await new Promise((r) => setTimeout(r, 5));
    const second = await runs.startScriptRun({
      projectId: P,
      cwd,
      script: script("twice", "exit 0"),
    });
    await settled(second.runId);
    const last = await runs.lastRunsByScript(P);
    assert.equal(last.twice.id, second.runId);
    assert.equal(last.twice.status, "passed");
    assert.equal(last.ok.status, "passed");
    assert.equal(last.bad.status, "failed");
    assert.deepEqual(await runs.lastRunsByScript("other"), {});
  });
});
