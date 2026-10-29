/**
 * M3: running a project's scripts and remembering the last run of each
 * (script_runs, migration 27). Background runs spawn detached through
 * lib/dev-servers.ts with a log under $HOME/.agent-os/logs; terminal runs
 * are typed into the session's shell drawer, wrapped so the exit code is
 * written to `<logs>/<runId>.exit`, which reconcileRuns() reads.
 */

import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { LOGS_DIR, spawnDetached } from "@/lib/dev-servers";
import type {
  ProjectScript,
  RunScriptResponse,
  ScriptRun,
  ScriptRunStatus,
} from "./project-config-types";

export interface StartScriptRunOptions {
  projectId: string;
  /** The folder it runs in (the project's, or the session's worktree) */
  cwd: string;
  script: ProjectScript;
  /** A terminal script with a session runs in its shell drawer; else background */
  sessionId?: string;
}

/** Runs kept per script; older rows and their logs are dropped */
const KEEP_RUNS = 20;
/** A terminal run whose exit file never came (drawer closed, never typed) */
const TERMINAL_STALE_MS = 6 * 60 * 60 * 1000;
const STOP_GRACE_MS = 1000;

export const isRunId = (id: string) => /^sr_[a-z0-9]+$/.test(id);

function newRunId(): string {
  return `sr_${Date.now().toString(36)}${BigInt(
    `0x${randomBytes(6).toString("hex")}`
  ).toString(36)}`;
}

export const exitPathFor = (runId: string) =>
  path.join(LOGS_DIR, `${runId}.exit`);
export const logPathFor = (runId: string) =>
  path.join(LOGS_DIR, `script-${runId}.log`);

/** Single-quoted for bash */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The line typed into the shell drawer: the command, then its exit code to the exit file */
export function terminalCommand(command: string, runId: string): string {
  return `${command}; printf %s $? > ${shellQuote(exitPathFor(runId))}`;
}

/**
 * The background argv: a login bash runs the command, and an outer bash
 * writes its exit code to the exit file, so the result survives a server
 * restart. No interpolation: the command and path are arguments.
 */
export function backgroundArgv(command: string, runId: string): string[] {
  return [
    "bash",
    "-c",
    'bash -lc "$1"; s=$?; printf %s "$s" > "$2"; exit "$s"',
    "agentos-script",
    command,
    exitPathFor(runId),
  ];
}

function rowOf(runId: string): ScriptRun | null {
  return (
    (getDb().prepare(`SELECT * FROM script_runs WHERE id = ?`).get(runId) as
      | ScriptRun
      | undefined) ?? null
  );
}

function readExitCode(runId: string): { code: number; at: number } | null {
  try {
    const file = exitPathFor(runId);
    const text = fs.readFileSync(file, "utf-8").trim();
    if (!/^\d+$/.test(text)) return null;
    return { code: Number(text), at: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Sets the final status, only while the row is still running */
function finish(
  runId: string,
  status: ScriptRunStatus,
  exitCode: number | null,
  at = Date.now()
): void {
  getDb()
    .prepare(
      `UPDATE script_runs SET status = ?, exit_code = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(status, exitCode, Math.round(at), runId);
}

const statusFor = (code: number): ScriptRunStatus =>
  code === 0 ? "passed" : "failed";

function prune(projectId: string, scriptId: string): void {
  const db = getDb();
  const old = db
    .prepare(
      `SELECT id, log_path FROM script_runs
       WHERE project_id = ? AND script_id = ? AND status != 'running'
       ORDER BY started_at DESC LIMIT -1 OFFSET ?`
    )
    .all(projectId, scriptId, KEEP_RUNS) as {
    id: string;
    log_path: string | null;
  }[];
  for (const row of old) {
    db.prepare(`DELETE FROM script_runs WHERE id = ?`).run(row.id);
    for (const file of [row.log_path, exitPathFor(row.id)]) {
      if (file) fs.rm(file, { force: true }, () => {});
    }
  }
}

export async function startScriptRun(
  opts: StartScriptRunOptions
): Promise<RunScriptResponse> {
  const { projectId, cwd, script, sessionId } = opts;
  const runIn =
    script.in === "background" || !sessionId ? "background" : "terminal";
  const runId = newRunId();
  const db = getDb();
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  prune(projectId, script.id);

  if (runIn === "terminal") {
    db.prepare(
      `INSERT INTO script_runs (id, project_id, script_id, command, status, log_path, started_at)
       VALUES (?, ?, ?, ?, 'running', NULL, ?)`
    ).run(runId, projectId, script.id, script.command, Date.now());
    return {
      runId,
      in: "terminal",
      shellCommand: terminalCommand(script.command, runId),
    };
  }

  if (!fs.existsSync(cwd)) throw new Error(`Folder not found: ${cwd}`);
  const logPath = logPathFor(runId);
  fs.writeFileSync(logPath, `$ ${script.command}\n`, "utf-8");
  db.prepare(
    `INSERT INTO script_runs (id, project_id, script_id, command, status, log_path, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`
  ).run(runId, projectId, script.id, script.command, logPath, Date.now());

  const child = spawnDetached({
    argv: backgroundArgv(script.command, runId),
    cwd,
    logPath,
  });
  child.on("error", (error) => {
    fs.appendFile(logPath, `\n${error.message}\n`, () => {});
    finish(runId, "failed", null);
  });
  child.on("exit", (code) => {
    const written = readExitCode(runId);
    if (written) finish(runId, statusFor(written.code), written.code);
    else if (code !== null) finish(runId, statusFor(code), code);
    else finish(runId, "failed", null);
  });
  if (child.pid) {
    db.prepare(`UPDATE script_runs SET pid = ? WHERE id = ?`).run(
      child.pid,
      runId
    );
  }
  return { runId, in: "background" };
}

/** SIGTERM then SIGKILL the process group; status "stopped" */
export async function stopScriptRun(runId: string): Promise<ScriptRun | null> {
  const run = rowOf(runId);
  if (!run) return null;
  if (run.status !== "running") return run;
  finish(runId, "stopped", null);
  const pid = run.pid;
  if (pid) {
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          process.kill(pid, sig);
        } catch {
          // Already gone
        }
      }
    };
    signal("SIGTERM");
    setTimeout(() => {
      if (pidAlive(pid)) signal("SIGKILL");
    }, STOP_GRACE_MS).unref();
  }
  return rowOf(runId);
}

export function getScriptRun(runId: string): ScriptRun | null {
  return rowOf(runId);
}

/** The last run of each script of a project, keyed by script id, reconciled */
export async function lastRunsByScript(
  projectId: string
): Promise<Record<string, ScriptRun>> {
  await reconcileRuns(projectId);
  const rows = getDb()
    .prepare(
      `SELECT r.* FROM script_runs r
       WHERE r.project_id = ? AND r.started_at = (
         SELECT MAX(started_at) FROM script_runs
         WHERE project_id = r.project_id AND script_id = r.script_id
       )
       ORDER BY r.started_at`
    )
    .all(projectId) as ScriptRun[];
  const runs: Record<string, ScriptRun> = {};
  for (const row of rows) runs[row.script_id] = row;
  return runs;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;
const TAIL_BYTES = 256 * 1024;

/** The last lines of a background run's log ([] for terminal runs) */
export async function readRunLog(runId: string, lines = 50): Promise<string[]> {
  const run = rowOf(runId);
  if (!run?.log_path) return [];
  let text: string;
  try {
    const handle = await fs.promises.open(run.log_path, "r");
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await handle.read(buf, 0, buf.length, start);
      text = buf.toString("utf-8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
  const all = text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).pop() ?? "");
  if (all.length && all[all.length - 1] === "") all.pop();
  return all.slice(-Math.max(1, lines));
}

/** Running rows whose process or exit file says they ended get their final status */
export async function reconcileRuns(projectId?: string): Promise<void> {
  const db = getDb();
  const rows = (
    projectId
      ? db
          .prepare(
            `SELECT * FROM script_runs WHERE status = 'running' AND project_id = ?`
          )
          .all(projectId)
      : db.prepare(`SELECT * FROM script_runs WHERE status = 'running'`).all()
  ) as ScriptRun[];
  const now = Date.now();
  for (const run of rows) {
    const written = readExitCode(run.id);
    if (written) {
      finish(run.id, statusFor(written.code), written.code, written.at);
    } else if (run.pid) {
      if (!pidAlive(run.pid)) finish(run.id, "failed", null);
    } else if (!run.log_path && now - run.started_at > TERMINAL_STALE_MS) {
      finish(run.id, "stopped", null);
    }
  }
}
