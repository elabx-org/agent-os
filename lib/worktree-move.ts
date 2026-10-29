/**
 * Move a running session into a new git worktree (M5 U2, N-Worktree).
 * Server only. Same Agent-OS session id, same tmux session.
 *
 * Busy: the move is stored as a `kind='move'` queue item at the head of
 * the session's queue and runs at its next idle edge (runScheduledMove,
 * from the dispatcher); nothing is typed into the agent; Cancel until it
 * starts. Ready: it runs now. While it runs the session is held
 * (lib/worktree-moving.ts, readiness "moving").
 *
 * Flow: (1) snapshot the source (lib/worktree-move-git.ts); (2) create the
 * worktree from HEAD with the exact branch and folder (lib/worktrees.ts);
 * (3) takeChanges: materialise + verify, then clean the snapshot's paths in
 * the source unless other live sessions use that folder; staged changes
 * refuse the move; (4) M3 setup steps (lib/env-setup.ts setupWorktree);
 * (5) Claude: `/exit` at idle, wait for the process to end (C-c after 10s),
 * copy (never move) <projectDirFor(old)>/<sid>.jsonl and <sid>/ to
 * projectDirFor(new) and verify sizes, update working_directory,
 * worktree_path, branch_name, base_branch in one transaction, relaunch in
 * the same tmux with `respawn-pane -k -c <worktree>` and `--resume <sid>`,
 * queue movedNoticeText first. Not ready within 60s: restore the row,
 * respawn in the old folder with --resume, keep the worktree, report it.
 * Others: the M4 handoff path in place (summary as first message, fresh
 * agent in the worktree). Any failure before the relaunch restores the
 * source from the snapshot and removes the worktree.
 */

import type { Session } from "./db";
import type { QueueItem } from "./queue/types";
import type {
  CancelMoveResult,
  MoveError,
  MovePreview,
  MoveRequest,
  MoveResult,
  MoveState,
} from "./worktree-move-types";

/** A refusal the routes turn into its status and MoveError body */
export class MoveRefused extends Error {
  constructor(
    readonly status: number,
    readonly body: MoveError
  ) {
    super(body.error);
  }
}

export async function movePreview(_session: Session): Promise<MovePreview> {
  throw new Error("Not implemented"); // M5 U2
}

/**
 * Validates, then runs now (ready) or schedules for the next idle edge
 * (busy). Throws MoveRefused
 */
export async function moveToWorktree(
  _session: Session,
  _request: MoveRequest
): Promise<MoveResult> {
  throw new Error("Not implemented"); // M5 U2
}

/** Cancels a scheduled move; MoveRefused not_scheduled / started */
export async function cancelMove(_session: Session): Promise<CancelMoveResult> {
  throw new Error("Not implemented"); // M5 U2
}

/** Every scheduled, running or failed move (Now's "Moving…") */
export function listMoves(): MoveState[] {
  throw new Error("Not implemented"); // M5 U2
}

/** One session's move state, null when none */
export function moveStateOf(_sessionId: string): MoveState | null {
  throw new Error("Not implemented"); // M5 U2
}

/**
 * Runs a claimed `kind='move'` queue item (the dispatcher, under the
 * session's lock, after two ready reads). Resolves when moved; throws with
 * the reason when it failed and was rolled back (the item is marked failed)
 */
export async function runScheduledMove(
  _session: Session,
  _item: QueueItem
): Promise<void> {
  throw new Error("Not implemented"); // M5 U2
}
