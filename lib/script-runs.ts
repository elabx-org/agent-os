/**
 * M3: running a project's scripts and remembering the last run of each
 * (script_runs, migration 27). Background runs spawn detached through
 * lib/dev-servers.ts with a log under $HOME/.agent-os/logs; terminal runs
 * are typed into the session's shell drawer, wrapped so the exit code is
 * written to `<logs>/<runId>.exit`, which reconcile() reads.
 *
 * Contract stubs: U3.1 implements.
 */

import type {
  ProjectScript,
  RunScriptResponse,
  ScriptRun,
} from "./project-config-types";

const TODO = "M3 U3.1: not implemented";

export interface StartScriptRunOptions {
  projectId: string;
  /** The folder it runs in (the project's, or the session's worktree) */
  cwd: string;
  script: ProjectScript;
  /** A terminal script with a session runs in its shell drawer; else background */
  sessionId?: string;
}

export async function startScriptRun(
  _opts: StartScriptRunOptions
): Promise<RunScriptResponse> {
  throw new Error(TODO);
}

/** SIGTERM then SIGKILL the process group; status "stopped" */
export async function stopScriptRun(_runId: string): Promise<ScriptRun | null> {
  throw new Error(TODO);
}

export function getScriptRun(_runId: string): ScriptRun | null {
  throw new Error(TODO);
}

/** The last run of each script of a project, keyed by script id, reconciled */
export async function lastRunsByScript(
  _projectId: string
): Promise<Record<string, ScriptRun>> {
  throw new Error(TODO);
}

/** The last lines of a background run's log ([] for terminal runs) */
export async function readRunLog(
  _runId: string,
  _lines?: number
): Promise<string[]> {
  throw new Error(TODO);
}

/** Running rows whose process or exit file says they ended get their final status */
export async function reconcileRuns(_projectId?: string): Promise<void> {
  throw new Error(TODO);
}
