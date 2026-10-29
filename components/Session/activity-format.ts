/**
 * How the session chrome words its live state: ages, token counts, the
 * working line and a workflow's phases (E-Live, N-Queue, Desk-Chat). Pure,
 * so the unit tests read them without a browser.
 */

import type { GitFile } from "@/lib/git-status";
import type { WorkflowInfo } from "@/lib/claude-workflows";

/** "40s", "9m", "1h 5m": how long, as the status card and rail say it */
export function formatAge(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

/** 41_200 as "41k tokens"; under a thousand as they are, a million as "1.2M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M tokens`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k tokens`;
  return `${n} ${n === 1 ? "token" : "tokens"}`;
}

/** The Live activity's corner: "9m · 41k tokens", either part when known */
export function liveSummary(
  ms: number | null | undefined,
  tokens: number | null | undefined
): string {
  return [
    ms != null ? formatAge(ms) : null,
    tokens != null && tokens > 0 ? formatTokens(tokens) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "Editing ActivityStrip.tsx": the activity's verb and what it's on, a
 * path cut to its file name (a command stays whole, the card truncates it)
 */
export function workingLine(now: { label: string; command?: string }): string {
  const { label, command } = now;
  if (!command) return label;
  const target =
    /\s/.test(command) || !command.includes("/")
      ? command
      : command.split("/").filter(Boolean).pop() || command;
  return `${label} ${target}`;
}

/** Lines added across the changed files: Desk-Chat's "Changes +59" */
export function addedLines(files: readonly GitFile[]): number {
  return files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
}

export interface PhaseRow {
  name: string;
  /** "2 agents" once done, "1 of 3" while running */
  detail: string;
  status: "done" | "active" | "todo";
  /** "done", how long the active one has run ("40s"), or nothing */
  right: string;
}

/**
 * A workflow run's phases as E-Live lists them: "Review · 2 agents  done",
 * "Verify · 1 of 3  40s". The run's current phase is active; the declared
 * ones before it are done, after it to do. `now` for the active phase's clock
 */
export function phaseRows(run: WorkflowInfo, now = Date.now()): PhaseRow[] {
  const names = [...run.phases];
  for (const agent of run.agents) {
    const name = agent.phase ?? "Other";
    if (!names.includes(name)) names.push(name);
  }
  const finished = run.status !== "running";
  const current = finished ? -1 : names.indexOf(run.phase ?? "");
  // Phases keep no start of their own: the active one shows the run's clock
  const startedAt = Date.parse(run.startedAt);
  return names.map((name, i) => {
    const agents = run.agents.filter((a) => (a.phase ?? "Other") === name);
    const doneCount = agents.filter((a) => a.status !== "running").length;
    const status: PhaseRow["status"] = finished
      ? agents.length || run.status === "done"
        ? "done"
        : "todo"
      : i === current
        ? "active"
        : current >= 0 && i < current
          ? "done"
          : agents.length && doneCount === agents.length
            ? "done"
            : "todo";
    const plural = `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`;
    return {
      name,
      detail:
        status === "active"
          ? `${doneCount} of ${agents.length}`
          : agents.length
            ? plural
            : "",
      status,
      right:
        status === "done"
          ? "done"
          : status === "active" && Number.isFinite(startedAt)
            ? formatAge(now - startedAt)
            : "",
    };
  });
}
