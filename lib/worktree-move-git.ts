/**
 * The git side of moving a session into a worktree (M5 U1). Server only.
 * argv-only git (lib/turns-git.ts), async, timeouts; never touches HEAD,
 * the user's index, stash or branches of the source checkout.
 *
 * snapshotForMove: a hidden commit of the working tree (untracked
 * included, ignored left out) through a private index, under
 * refs/agent-os/<sessionId>/move-<ms>. materialise: that tree into the new
 * worktree with its own private index (`read-tree` + `checkout-index`),
 * then verify. cleanSource: only the snapshot's paths, by writing HEAD's
 * blobs (`cat-file`) and unlinking added files, never checkout/stash/reset.
 * restoreSource: puts the snapshot's content back (rollback).
 */

import type { UncommittedFile } from "./worktree-move-types";

/** The source checkout as the move sees it */
export interface WorkingTreeState {
  /** The repository's top folder */
  toplevel: string;
  /** HEAD's commit sha */
  head: string;
  /** Checked-out branch, null when detached */
  branch: string | null;
  /** Untracked included, ignored left out */
  uncommitted: UncommittedFile[];
  /** Anything staged in the user's index (the move is refused) */
  staged: boolean;
}

/** How a snapshot path differs from HEAD */
export type MoveChange = "modified" | "added" | "deleted";

export interface MoveSnapshotPath {
  path: string;
  change: MoveChange;
  /** File mode in the snapshot tree (e.g. "100644"), null when deleted */
  mode: string | null;
}

export interface MoveSnapshot {
  /** refs/agent-os/<sessionId>/move-<ms> */
  ref: string;
  /** The snapshot commit */
  commit: string;
  /** Its tree */
  tree: string;
  /** HEAD it was taken over */
  head: string;
  /** Repository-relative paths that differ from HEAD */
  paths: MoveSnapshotPath[];
  /**
   * Untracked files the snapshot left out (too large); the move refuses
   * to clean the source when non-empty
   */
  skipped: string[];
}

/** Null outside git */
export async function readWorkingTree(
  _cwd: string
): Promise<WorkingTreeState | null> {
  throw new Error("Not implemented"); // M5 U1
}

/** A valid name for a new branch (`git check-ref-format --branch`) */
export async function isValidBranchName(
  _cwd: string,
  _branch: string
): Promise<boolean> {
  throw new Error("Not implemented"); // M5 U1
}

/**
 * "fix/keyboardbar-haptics" from the session's name (lib/branch-name.ts),
 * with the next free `-2`, `-3`, … when it exists
 */
export async function suggestBranch(
  _cwd: string,
  _sessionName: string
): Promise<string> {
  throw new Error("Not implemented"); // M5 U1
}

/**
 * The default folder for a branch: under getWorktreesDir(), named
 * `<repo>-<branch slug>`, the next free `-2`, … when it exists
 */
export function suggestFolder(_repoName: string, _branch: string): string {
  throw new Error("Not implemented"); // M5 U1
}

/** Snapshot of the working tree for a move */
export async function snapshotForMove(
  _cwd: string,
  _sessionId: string
): Promise<MoveSnapshot> {
  throw new Error("Not implemented"); // M5 U1
}

/** Writes the snapshot's tree into the worktree (private index), then verifies */
export async function materialise(
  _snapshot: MoveSnapshot,
  _sourceCwd: string,
  _worktreePath: string
): Promise<void> {
  throw new Error("Not implemented"); // M5 U1
}

/** The worktree's files match the snapshot for every snapshot path */
export async function verifyMaterialised(
  _snapshot: MoveSnapshot,
  _worktreePath: string
): Promise<boolean> {
  throw new Error("Not implemented"); // M5 U1
}

/** Returns the source's snapshot paths to HEAD (only those paths) */
export async function cleanSource(
  _cwd: string,
  _snapshot: MoveSnapshot
): Promise<void> {
  throw new Error("Not implemented"); // M5 U1
}

/** Puts the snapshot's content back in the source (rollback of cleanSource) */
export async function restoreSource(
  _cwd: string,
  _snapshot: MoveSnapshot
): Promise<void> {
  throw new Error("Not implemented"); // M5 U1
}

/** Deletes the snapshot ref (after a successful move it is kept a while) */
export async function dropSnapshot(
  _cwd: string,
  _snapshot: MoveSnapshot
): Promise<void> {
  throw new Error("Not implemented"); // M5 U1
}
