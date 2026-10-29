import { shortAge } from "@/lib/agent-state";
import type { ProjectScript, ScriptRun } from "@/lib/project-config-types";

/**
 * M3 (U3.2): what the Scripts sheet and the project page say about a
 * script, from its last run. Pure, so it is unit tested.
 */

export interface ScriptEntry {
  script: ProjectScript;
  /** Its last run, if it ever ran */
  run?: ScriptRun;
}

/** Running scripts first (the cards), then the rest in the file's order */
export function splitScripts(
  scripts: readonly ProjectScript[] | undefined,
  runs: Record<string, ScriptRun> | undefined
): { running: ScriptEntry[]; idle: ScriptEntry[] } {
  const running: ScriptEntry[] = [];
  const idle: ScriptEntry[] = [];
  for (const script of scripts ?? []) {
    const run = runs?.[script.id];
    (run?.status === "running" ? running : idle).push({ script, run });
  }
  running.sort((a, b) => a.run!.started_at - b.run!.started_at);
  return { running, idle };
}

/** "20m ago", "just now" */
export function ago(at: number, now = Date.now()): string {
  const age = shortAge(at, now);
  if (!age) return "";
  return age === "now" ? "just now" : `${age} ago`;
}

/**
 * The row's second line from the last run: "Passed 20m ago", "Failed 2m
 * ago", "Last run 2h ago"; null when it never ran (the row shows the command)
 */
export function lastRunText(
  run: ScriptRun | undefined,
  now = Date.now()
): string | null {
  if (!run || run.status === "running") return null;
  const when = ago(run.finished_at ?? run.started_at, now);
  if (run.status === "passed") return `Passed ${when}`;
  if (run.status === "failed") return `Failed ${when}`;
  return `Last run ${when}`;
}

/** The preview URL's port as the card shows it (":3000"), if it names one */
export function previewPort(previewUrl: string | undefined): string | null {
  if (!previewUrl) return null;
  try {
    const port = new URL(previewUrl).port;
    return port ? `:${port}` : null;
  } catch {
    return null;
  }
}

/** Scripts that look like they serve the preview: a dev server, a site */
const SERVES = /\b(dev|serve|start|preview)\b/i;

/**
 * Which running script the preview URL belongs to (its card shows the port
 * and Open preview): one with the monitor/globe icon or a dev-server
 * command, else the only one running
 */
export function previewScriptId(
  running: readonly ScriptEntry[],
  previewUrl: string | undefined
): string | null {
  if (!previewUrl || !running.length) return null;
  const server =
    running.find(
      ({ script }) => script.icon === "monitor" || script.icon === "globe"
    ) ?? running.find(({ script }) => SERVES.test(script.command));
  if (server) return server.script.id;
  return running.length === 1 ? running[0].script.id : null;
}

/** "● Running · :3000 · 14m": the dot is drawn, this is the rest */
export function runningText(
  run: ScriptRun,
  port: string | null,
  now = Date.now()
): string[] {
  const up = shortAge(run.started_at, now);
  return ["Running", port, up === "now" ? "just now" : up].filter(
    (part): part is string => !!part
  );
}

// CSI sequences (colours, cursor moves) and OSC titles that tools print
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g;

/** A log line without terminal colour codes or carriage returns */
export function stripAnsi(line: string): string {
  return line.replace(ANSI, "");
}
