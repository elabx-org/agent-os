/**
 * M5 "Move to a worktree" (N-Worktree): the shapes shared by the routes
 * (app/api/sessions/[id]/move-to-worktree{,/preview}, app/api/worktree-moves),
 * lib/worktree-move.ts, lib/worktree-move-git.ts and the sheet. No server
 * imports.
 */

import type { Session } from "./db/types";

/**
 * resumed: Claude keeps its conversation (--resume in the new folder, same
 * tmux). handoff: any other agent starts fresh in the worktree with a
 * summary (lib/summarize.ts) as its first message. Same Agent-OS session id
 * either way
 */
export type MoveMode = "resumed" | "handoff";

/** The mode a session's move takes: Claude resumes, the others hand off */
export function moveModeFor(agentType: string | null | undefined): MoveMode {
  return (agentType || "claude") === "claude" ? "resumed" : "handoff";
}

/** One uncommitted path in the source checkout */
export interface UncommittedFile {
  path: string;
  /** Porcelain XY, e.g. " M", "A ", "??", " D" */
  status: string;
}

/** Another live session working in the same source folder */
export interface OtherSession {
  id: string;
  name: string;
}

/**
 * Why a move (or its cancel) was refused. HTTP status in brackets.
 * staged: the user has staged changes; cleaning would touch their index
 *   ("Unstage or commit first") [409]
 * native_worktree: a Claude `--worktree` session (v1 refuses) [400]
 * already_worktree: it already works in an Agent-OS worktree [400]
 * not_git: the folder isn't in a git repository [400]
 * paused: handed off (M4); resume it first [409]
 * in_progress: a move is already scheduled or running [409]
 * bad_branch: not a valid new branch name [400]
 * branch_exists: the branch already exists [409]
 * bad_folder: the folder isn't an allowed absolute path [400]
 * folder_exists: the folder already exists [409]
 * no_transcript: a Claude session with no conversation to resume [400]
 * not_scheduled: cancel with nothing scheduled [404]
 * started: cancel after the move began [409]
 */
export type MoveRefusal =
  | "staged"
  | "native_worktree"
  | "already_worktree"
  | "not_git"
  | "paused"
  | "in_progress"
  | "bad_branch"
  | "branch_exists"
  | "bad_folder"
  | "folder_exists"
  | "no_transcript"
  | "not_scheduled"
  | "started";

export interface MoveError {
  error: string;
  reason?: MoveRefusal;
}

/**
 * Where a move stands. scheduled: waits for the session's next idle edge
 * (a `kind='move'` queue item; Cancel works). moving: running now (Now says
 * "Moving…"). failed: rolled back, with the error, until dismissed or a
 * new move. A finished move leaves no state: the session row has moved
 */
export type MovePhase = "scheduled" | "moving" | "failed";

export interface MoveState {
  sessionId: string;
  phase: MovePhase;
  branch: string;
  /** The requested (or created) worktree folder, absolute */
  worktreePath: string;
  takeChanges: boolean;
  mode: MoveMode;
  /** The scheduled queue item, while it waits */
  queueItemId: number | null;
  /** ms: when scheduled (scheduled) or started (moving/failed) */
  at: number;
  error: string | null;
  /**
   * After a failed relaunch: the worktree kept for inspection (the session
   * is back in its old folder)
   */
  keptWorktree: string | null;
}

/** GET /api/sessions/[id]/move-to-worktree/preview: the sheet's data */
export interface MovePreview {
  /** Uncommitted paths (untracked included, ignored left out) */
  uncommitted: UncommittedFile[];
  /** From the session's name, e.g. "fix/keyboardbar-haptics" */
  suggestedBranch: string;
  /** Suggested worktree folder, absolute */
  folder: string;
  /** The same with $HOME as "~", for display */
  folderDisplay: string;
  /** The user has staged changes: the move is refused until they unstage */
  staged: boolean;
  /**
   * Other live sessions in the same source folder: the changes are copied
   * but left in the source (they may be those sessions' work)
   */
  otherSessions: OtherSession[];
  /** The repository's folder name, e.g. "agent-os" */
  repoName: string;
  /** The source checkout's branch, null when detached */
  currentBranch: string | null;
  /** Mid-turn: the move is scheduled for the next idle edge */
  busy: boolean;
  mode: MoveMode;
  agentType: string;
  /** Set when the move can't be done at all (the sheet says why) */
  refusal: MoveError | null;
  /** A move already scheduled, running or failed for this session */
  pending: MoveState | null;
}

/** POST /api/sessions/[id]/move-to-worktree (requireUser) */
export interface MoveRequest {
  branch: string;
  /** Absolute or "~/..."; default: MovePreview.folder for the branch */
  folder?: string;
  /** Carry the uncommitted changes and clean them from the source */
  takeChanges: boolean;
}

export interface MoveResult {
  worktreePath: string;
  branch: string;
  mode: MoveMode;
  /** True: busy, stored and run at the next idle edge (nothing moved yet) */
  scheduled: boolean;
  /** The session row (moved, or unchanged when scheduled) */
  session: Session;
  /**
   * The changes were carried but left in the source because other live
   * sessions use that folder (false when not taken or nothing to take)
   */
  sourceKept: boolean;
}

/** DELETE /api/sessions/[id]/move-to-worktree (requireUser): cancel */
export interface CancelMoveResult {
  cancelled: true;
}

/** GET /api/worktree-moves: every scheduled, running or failed move */
export interface MovesList {
  moves: MoveState[];
}

/**
 * The queue item that runs a scheduled move: `kind='move'`,
 * `origin='system'`, its `text` this JSON. Never typed into the agent; the
 * dispatcher hands it to lib/worktree-move.ts runScheduledMove
 */
export interface MoveQueuePayload {
  v: 1;
  request: MoveRequest;
  /** Resolved absolute folder */
  worktreePath: string;
  scheduledAt: number;
}

export function encodeMovePayload(payload: MoveQueuePayload): string {
  return JSON.stringify(payload);
}

export function decodeMovePayload(text: string): MoveQueuePayload | null {
  try {
    const p = JSON.parse(text) as Partial<MoveQueuePayload>;
    if (
      p?.v !== 1 ||
      typeof p.worktreePath !== "string" ||
      typeof p.scheduledAt !== "number" ||
      typeof p.request?.branch !== "string" ||
      typeof p.request?.takeChanges !== "boolean"
    ) {
      return null;
    }
    return p as MoveQueuePayload;
  } catch {
    return null;
  }
}

/**
 * The first message the moved session gets (queued, kind='message',
 * origin='system'), so the agent knows its new folder
 */
export function movedNoticeText(
  worktreePath: string,
  branch: string,
  from: string
): string {
  return `[AgentOS: this session moved from ${from} to the worktree ${worktreePath} on branch ${branch}. Work there from now on; the uncommitted changes came along if the user chose to take them.]`;
}

/** "KeyboardBar.swift, Haptics.swift +1": the sheet's changes caption */
export function changesCaption(files: UncommittedFile[], shown = 2): string {
  if (!files.length) return "";
  const names = files.slice(0, shown).map((f) => {
    const parts = f.path.split("/");
    return parts[parts.length - 1] || f.path;
  });
  const rest = files.length - names.length;
  return rest > 0 ? `${names.join(", ")} +${rest}` : names.join(", ");
}
