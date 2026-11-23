/**
 * A job: one piece of work a chat hands to another machine (a build on the
 * Mac, say) while the chat itself stays where it is. The machine runs it as
 * a session of its own in a throwaway copy of the chat's code, and the
 * result comes back. Client-safe: the words and shapes both sides and the
 * page share (lib/jobs/hub.ts asks, lib/jobs/runner.ts runs).
 */

export const JOB_STATES = [
  "queued",
  "sending",
  "running",
  "waiting",
  "done",
  "failed",
  "stopped",
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Still going: its machine is busy with it */
export const isActive = (state: JobState) =>
  state === "sending" || state === "running" || state === "waiting";

/** Over: nothing more will happen to it */
export const isOver = (state: JobState) =>
  state === "done" || state === "failed" || state === "stopped";

export const JOB_ID = /^job_[0-9a-f]{12}$/;
export const TITLE_MAX = 120;
export const TASK_MAX = 8000;
export const RESULT_MAX = 12000;
/** A patch larger than this stays on the machine that made it */
export const PATCH_MAX = 8 * 1024 * 1024;

/**
 * How much a job's session may do on the machine without asking. The
 * machine's own setting, the user's alone to change; never Full access
 */
export const JOB_MODES = ["manual", "acceptEdits", "auto"] as const;
export type JobMode = (typeof JOB_MODES)[number];

export const JOB_MODE_LABELS: Record<JobMode, string> = {
  manual: "Ask first",
  acceptEdits: "Accept edits",
  auto: "Auto",
};

export const jobModeHint = (mode: JobMode, name: string): string =>
  mode === "manual"
    ? `A job asks you before every edit and command, so a build waits until you answer it on ${name}.`
    : mode === "acceptEdits"
      ? "A job edits files in its own folder freely and asks you before it runs commands."
      : "A job works by itself and asks you only before something risky. Builds and tests run without waiting for you.";

/** The same, in a line on the Runners page */
export const jobModeLine = (mode: JobMode): string =>
  mode === "manual"
    ? "Jobs here ask you before every edit and command."
    : mode === "acceptEdits"
      ? "Jobs here edit files freely and ask you before commands."
      : "Jobs here work by themselves and ask only before something risky.";

export const cleanJobMode = (value: unknown): JobMode | null =>
  JOB_MODES.includes(value as JobMode) ? (value as JobMode) : null;

/** How it was sent: the user named the machine, a rule did, or the chat chose */
export type JobVia = "mention" | "rule" | "chat" | "again";

/** The chat's code as the job got it */
export interface JobCode {
  /** The commit the chat was on */
  head: string;
  /** Unsaved files that went with it */
  unsaved: number;
  /** Files left behind (too large, or a nested repository) */
  skipped: number;
}

export interface JobChangedFile {
  path: string;
  added: number;
  removed: number;
}

/** What the job changed in its copy of the code */
export interface JobChanged {
  files: JobChangedFile[];
  /** More files than are listed */
  more: number;
  /** The patch was too large to bring back */
  tooBig: boolean;
}

export interface Job {
  id: string;
  machineId: string;
  machineName: string;
  /** The chat that asked */
  sessionId: string | null;
  sessionName: string | null;
  projectId: string | null;
  title: string;
  task: string;
  state: JobState;
  /** What is happening now, in a few words */
  step: string | null;
  /** What it asks the user while it waits */
  question: string | null;
  /** Its session on the machine that runs it */
  jobSession: string | null;
  code: JobCode | null;
  result: string | null;
  changed: JobChanged | null;
  /** Where the patch of its changes is kept here; null when there is none */
  patch: string | null;
  error: string | null;
  via: JobVia;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Ahead of it on the same machine, while it waits its turn */
  ahead: number;
}

/** What a machine tells its hub about a job it runs */
export interface JobReport {
  state: JobState;
  step: string | null;
  question: string | null;
  jobSession: string | null;
  result: string | null;
  changed: JobChanged | null;
  /** Whether a patch can be fetched */
  patch: boolean;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

/** One project's kept build output on a machine */
export interface JobCache {
  name: string;
  bytes: number;
  usedAt: number;
}

/** The space jobs take on a machine: all of it is in one folder */
export interface JobSpace {
  /** That folder, with ~ for the home folder */
  folder: string;
  /** Working folders of jobs still kept */
  work: number;
  /** Code kept for projects this machine has no checkout of */
  repos: number;
  caches: JobCache[];
  /** Free space on the disk it is on; null when it can't be read */
  free: number | null;
}

/** How long a job's working folder is kept after it ends */
export const KEEP_DONE_MS = 60 * 60 * 1000;
export const KEEP_FAILED_MS = 24 * 60 * 60 * 1000;
/** A job waiting for a machine that stays off is dropped after this long */
export const QUEUE_WAIT_MS = 24 * 60 * 60 * 1000;
/** A project's kept build output goes after this long without a job */
export const CACHE_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
/** Kept build output of all projects together; the longest unused goes first */
export const CACHE_MAX_BYTES = 20 * 1024 * 1024 * 1024;

export const JOB_REFUSALS = {
  no_machine: "No machine by that name is linked to this server.",
  not_here:
    "Jobs are sent from the server. A session on a linked machine can't send one yet.",
  from_job: "A job can't send jobs of its own.",
  from_started:
    "A session that another machine's session started can't send jobs.",
  no_session: "Only a session can send a job.",
  agents_off: (name: string) =>
    `${name} doesn't take work from sessions on other machines. The user can allow it in AgentOS: Settings, Machines.`,
  offline: (name: string) =>
    `${name} is off or can't be reached right now. Nothing was sent.`,
  old: (name: string) =>
    `${name} runs an AgentOS that can't take jobs yet. It updates itself within a few minutes of this server.`,
  too_many: "This chat already has 10 jobs waiting or running.",
  bad: "A job needs a title and a task.",
} as const;

export function stateWord(state: JobState): string {
  switch (state) {
    case "queued":
      return "Waiting its turn";
    case "sending":
      return "Getting ready";
    case "running":
      return "Running";
    case "waiting":
      return "Needs you";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

/** "2m 14s", "48s", "1h 3m" */
export function tookText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The line under a job's title */
export function jobLine(job: Job, now: number): string {
  const on = job.machineName;
  switch (job.state) {
    case "queued":
      return job.ahead > 0
        ? `Waiting its turn on ${on}, ${job.ahead} ahead of it`
        : `Waiting its turn on ${on}`;
    case "sending":
      return job.step ?? `Copying the code to ${on}`;
    case "running":
      return `Running on ${on} for ${tookText(now - (job.startedAt ?? job.createdAt))}`;
    case "waiting":
      return `Waiting for you on ${on}`;
    case "done":
      return `Done on ${on} in ${tookText((job.endedAt ?? now) - (job.startedAt ?? job.createdAt))}`;
    case "failed":
      return `Failed on ${on}`;
    case "stopped":
      return `Stopped on ${on}`;
  }
}

/**
 * A project's say on work its chats' machine can't do (Project settings,
 * projects.job_rule as JSON; NULL is DEFAULT_JOB_RULE)
 */
export interface JobRule {
  /** The chat sends it to the machine that can, or asks the user first */
  send: "auto" | "ask";
  /** That machine is off: tell the user and wait, or use GitHub Actions */
  off: "wait" | "actions";
}

export const DEFAULT_JOB_RULE: JobRule = { send: "auto", off: "wait" };

/** From the stored JSON or a request's body; anything else is the default */
export function parseJobRule(raw: unknown): JobRule {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const v = (value ?? {}) as Partial<JobRule>;
  return {
    send: v.send === "ask" ? "ask" : "auto",
    off: v.off === "actions" ? "actions" : "wait",
  };
}

export const isDefaultJobRule = (rule: JobRule): boolean =>
  rule.send === DEFAULT_JOB_RULE.send && rule.off === DEFAULT_JOB_RULE.off;

/** Who chose the machine, for the job's card */
export function sentText(job: Pick<Job, "via" | "sessionName">): string {
  const chat = job.sessionName ?? "A chat";
  switch (job.via) {
    case "mention":
      return `You named this machine with @ in ${job.sessionName ?? "a chat"}.`;
    case "again":
      return `You ran it again. First sent by ${job.sessionName ?? "a chat"}.`;
    default:
      return `${chat} chose this machine for it.`;
  }
}

/** "3 files changed" / "No files changed" */
export function changedText(changed: JobChanged | null): string {
  const count = changed ? changed.files.length + changed.more : 0;
  if (count === 0) return "No files changed";
  return `${count} ${count === 1 ? "file" : "files"} changed`;
}

/** "with 3 unsaved files" */
export function codeText(code: JobCode | null): string {
  if (!code) return "No code was sent";
  const unsaved =
    code.unsaved === 0
      ? ""
      : `, with ${code.unsaved} unsaved ${code.unsaved === 1 ? "file" : "files"}`;
  return `The chat's code${unsaved}`;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function changedOf(value: unknown): JobChanged | null {
  const v = value as Partial<JobChanged> | null;
  if (!v || !Array.isArray(v.files)) return null;
  const files: JobChangedFile[] = [];
  for (const f of v.files.slice(0, 200)) {
    const path = text((f as JobChangedFile)?.path, 400);
    if (!path) continue;
    files.push({
      path,
      added: Math.max(0, Number((f as JobChangedFile).added) || 0),
      removed: Math.max(0, Number((f as JobChangedFile).removed) || 0),
    });
  }
  return {
    files,
    more: Math.max(0, Math.floor(Number(v.more) || 0)),
    tooBig: v.tooBig === true,
  };
}

/** A machine's report, field by field: it is that machine's word */
export function cleanReport(value: unknown): JobReport | null {
  const v = value as Partial<JobReport> | null;
  if (!v || !JOB_STATES.includes(v.state as JobState)) return null;
  const at = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  const session = text(v.jobSession, 100);
  return {
    state: v.state as JobState,
    step: text(v.step, 200),
    question: text(v.question, 600),
    jobSession: session && /^[\w-]+$/.test(session) ? session : null,
    result: text(v.result, RESULT_MAX),
    changed: changedOf(v.changed),
    patch: v.patch === true,
    error: text(v.error, 600),
    startedAt: at(v.startedAt),
    endedAt: at(v.endedAt),
  };
}

export function cleanSpace(value: unknown): JobSpace | null {
  const v = value as Partial<JobSpace> | null;
  if (!v || !Array.isArray(v.caches)) return null;
  const n = (x: unknown) => Math.max(0, Number(x) || 0);
  return {
    folder: text(v.folder, 300) ?? "",
    work: n(v.work),
    repos: n(v.repos),
    caches: v.caches
      .slice(0, 200)
      .map((c) => ({
        name: text((c as JobCache)?.name, 120) ?? "",
        bytes: n((c as JobCache)?.bytes),
        usedAt: n((c as JobCache)?.usedAt),
      }))
      .filter((c) => c.name && /^[\w.-]+$/.test(c.name)),
    free: typeof v.free === "number" && v.free >= 0 ? v.free : null,
  };
}

/** What the job's session is told before its task */
export function jobPrompt(input: {
  title: string;
  task: string;
  from: string;
  chat: string | null;
  cache: string;
  code: boolean;
  /** The project's own Claude files were taken out of the copy */
  stripped?: boolean;
}): string {
  const chat = input.chat ? `the chat "${input.chat}"` : "a chat";
  return [
    `You are running one job for ${chat} on ${input.from}. That chat stays there; only this job came here.`,
    input.code
      ? "This folder is a throwaway copy of that chat's code, with its unsaved changes. It is removed after the job, so nothing here needs tidying."
      : "This folder is empty and yours for the job. It is removed afterwards.",
    ...(input.stripped
      ? [
          "The project's own Claude files (.claude folders and .mcp.json: its settings, hooks, skills, agents and MCP servers) are left out of this copy; what is set up for Claude on this machine applies. Don't put them back.",
        ]
      : []),
    "",
    `The job: ${input.title}`,
    "",
    input.task,
    "",
    "While you work:",
    "- Stay in this folder. Don't install anything machine-wide (Homebrew, global packages, new simulators or runtimes) without asking first; use what the machine has.",
    `- Build output worth keeping for the next job goes in ${input.cache} (with Xcode: -derivedDataPath ${input.cache}/DerivedData). Everything in this folder is lost.`,
    "- Don't push, open pull requests, or sign and upload anything unless the job says so.",
    "- Files you change here go back to the chat as a patch it can apply. Don't commit them.",
    "- Your last message is the result the chat receives. Say plainly what you ran, what happened (with the numbers or the error text that matter), and which files you changed.",
  ].join("\n");
}
