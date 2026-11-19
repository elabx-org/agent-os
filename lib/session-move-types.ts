/**
 * "Continue on another machine": a Claude session leaves one AgentOS and
 * resumes on a linked one, with the same conversation, branch and
 * uncommitted changes. Shapes shared by the two sides (lib/session-move.ts),
 * the hub that pipes between them (lib/link/move.ts) and the pages.
 * No server imports.
 */

import { capForAgent, normalizeMode } from "./permission-mode";
import type { MoveSnapshot } from "./worktree-move-git";

/** "hub" or a machine id, as the hub names them */
export type MachineRef = string;

/** sessions.moved_to: where a settled session went on */
export interface MovedTo {
  machine: MachineRef;
  /** The machine's name when it left, for the row's line */
  name: string;
  at: number;
  /** What its folder held when it left, to tell an untouched folder later */
  head: string;
  /** The branch its folder was on (null detached; absent on older rows) */
  branch?: string | null;
  snapshot: MoveSnapshot | null;
}

/** sessions.moved_from: where a session came from */
export interface MovedFrom {
  machine: MachineRef;
  name: string;
  at: number;
}

export function parseMovedTo(value: string | null | undefined): MovedTo | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MovedTo;
    return typeof parsed?.machine === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseMovedFrom(
  value: string | null | undefined
): MovedFrom | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as MovedFrom;
    return typeof parsed?.machine === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** A move's id, as both machines and the hub accept it */
export const MOVE_ID = /^[0-9a-f]{16}$/;

/**
 * Branch names a move carries over: plain ones only, since the name ends
 * up in git and launch commands on another machine
 */
export const safeBranch = (name: unknown): name is string =>
  typeof name === "string" &&
  name.length <= 200 &&
  /^[A-Za-z0-9_][A-Za-z0-9_./+@-]*$/.test(name) &&
  !name.includes("..");

/** A repository-relative path that stays inside the repository */
export function safeRepoPath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > 4096) {
    return false;
  }
  if (/[\0\\]/.test(value) || value.startsWith("/")) return false;
  return value
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        part.toLowerCase() !== ".git"
    );
}

/** Everything the other machine needs to take a session over */
export interface MoveManifest {
  v: 1;
  moveId: string;
  sessionId: string;
  name: string;
  claudeSessionId: string;
  model: string;
  modelPinned: boolean;
  effort: string | null;
  permissionMode: string | null;
  autoApprove: boolean;
  subagentModel: string | null;
  subagentOwnFirst: boolean;
  systemPrompt: string | null;
  /** Claude already trusts the folder it leaves (its trust screen) */
  sourceTrusted?: boolean;
  repo: {
    /** The repository folder's name */
    name: string;
    /** origin's URL, null without one */
    remote: string | null;
    head: string;
    /** null when detached */
    branch: string | null;
    /** The session's folder inside the repository ("" at its top) */
    subdir: string;
  };
  /** Uncommitted work as a hidden commit, null when the folder is clean */
  snapshot: MoveSnapshot | null;
}

/** Why a session can't leave (409 unless noted) */
export type MoveOutRefusal =
  | "not_claude"
  | "paused"
  | "moved"
  | "busy"
  | "no_conversation"
  | "not_git"
  | "no_commits";

export const MOVE_OUT_ERRORS: Record<MoveOutRefusal, string> = {
  not_claude: "Only Claude sessions can continue on another machine",
  paused: "This session was handed off; continue the one it went to",
  moved:
    "This copy already continued on another machine. Open it there, or bring it back",
  busy: "It's working or has queued messages. Wait for it to finish, or stop it, then try again",
  no_conversation: "There's no conversation to continue yet",
  not_git:
    "Its folder isn't a git repository, so its files can't follow it to another machine",
  no_commits: "Its repository has no commits yet",
};

/** The receiving side's progress, polled by the hub */
export interface MoveInState {
  moveId: string;
  phase: "preparing" | "ready" | "importing" | "done" | "failed";
  /** Commits the machine already holds (ready) */
  have?: string[];
  error?: string;
  /** done */
  result?: MoveInResult;
}

export interface MoveInResult {
  sessionId: string;
  folder: string;
  branch: string | null;
  /** The branch name it had, when this machine had to pick another */
  renamedFrom?: string;
  /** Untracked files too large to bring (they stayed behind) */
  leftBehind: string[];
  /** It left with full access; here it starts asking again */
  fullAccessOff?: boolean;
  /** Claude is asking whether to trust the folder on that machine */
  needsTrust?: boolean;
}

/** DELETE /api/session-moves/[move] */
export interface MoveInCancel {
  /** False when it was already being put in place: poll for how it ends */
  stopped: boolean;
  phase: MoveInState["phase"];
}

/** POST /api/machines/move body */
export interface MoveRequest {
  sessionId: string;
  from: MachineRef;
  to: MachineRef;
}

export type MoveStep =
  | "pausing"
  | "preparing"
  | "code"
  | "conversation"
  | "starting"
  | "done"
  | "failed";

/** GET /api/machines/move?id= */
export interface MoveJob {
  id: string;
  sessionId: string;
  from: MachineRef;
  to: MachineRef;
  toName: string;
  fromName: string;
  step: MoveStep;
  /** The step it failed in */
  failedAt?: MoveStep;
  error?: string;
  /**
   * After a failure: true when it runs again where it was, false when it
   * stays paused there (nobody could confirm the other machine stopped)
   */
  restored?: boolean;
  /** It moved, but something the user should know went wrong after */
  warning?: string;
  result?: MoveInResult;
}

/** What the user reads while it moves */
export function moveStepText(
  step: MoveStep,
  toName: string,
  fromName?: string
): string {
  switch (step) {
    case "pausing":
      return fromName ? `Pausing it on ${fromName}` : "Pausing it here";
    case "preparing":
      return `Getting ${toName} ready`;
    case "code":
      return "Sending the code";
    case "conversation":
      return "Sending the conversation";
    case "starting":
      return `Starting it on ${toName}`;
    case "done":
      return `Now on ${toName}`;
    case "failed":
      return "It didn't move";
  }
}

/** The first message Claude gets on the new machine */
export function arrivedNoticeText(
  toName: string,
  platform: string,
  folder: string,
  fromName: string,
  leftBehind: string[]
): string {
  const lines = [
    `[AgentOS] This session now runs on ${toName} (${platform}). It was moved here from ${fromName} with the same conversation, branch and uncommitted changes.`,
    `Its folder is now ${folder}. Paths (including saved tool outputs and checkpoints), running processes, servers and installed tools from earlier in this conversation were on ${fromName}; check before relying on them.`,
    `Files git ignores (such as .env or local config) and changes inside submodules did not come along; they are still on ${fromName}.`,
  ];
  if (leftBehind.length > 0) {
    lines.push(
      `These files were not brought (large untracked files or submodule changes) and stayed on ${fromName}: ${leftBehind.join(", ")}`
    );
  }
  lines.push("No reply is needed; carry on when asked.");
  return lines.join("\n");
}

/** Same repository, however the URL is written (ssh, https, .git) */
export function sameRemote(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (url: string) =>
    url
      .trim()
      .replace(/^[a-z+]+:\/\//i, "")
      .replace(/^[^@/]+@/, "")
      .replace(/:(?!\d+\/)/, "/")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The row a moved session gets here. A session placed in a worktree works
 * in that worktree (never the main checkout), and AgentOS owns it
 */
export function arrivalRow(
  placed: { top: string; branch: string | null; worktree: boolean },
  folder: string,
  existingBranch: string | null
): {
  working_directory: string;
  worktree_path: string | null;
  branch_name: string | null;
} {
  return {
    working_directory: folder,
    worktree_path: placed.worktree ? placed.top : null,
    branch_name: placed.worktree ? placed.branch : existingBranch,
  };
}

/** What a moved session may do on arrival: never full access unasked */
export function arrivalMode(
  m: Pick<MoveManifest, "permissionMode" | "autoApprove">
): {
  mode: string | null;
  fullAccessOff: boolean;
} {
  const stored = normalizeMode(m.permissionMode);
  const full =
    stored === "bypassPermissions" || (stored === null && !!m.autoApprove);
  if (full)
    return { mode: capForAgent("bypassPermissions"), fullAccessOff: true };
  return { mode: stored, fullAccessOff: false };
}
