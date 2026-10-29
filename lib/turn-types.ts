/**
 * Per-turn changes and undo: the shapes of the turns and diff routes,
 * shared with the client (hooks/useTurns.ts). No server imports.
 */

import type { ParsedDiff } from "./diff-parser";

export interface TurnFile {
  path: string;
  /** Added, modified, deleted, renamed in pre..post */
  status: "A" | "M" | "D" | "R";
  added: number;
  removed: number;
}

/** GET /api/sessions/[id]/turns: one turn */
export interface Turn {
  turnNo: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Every file changed in the turn's snapshots */
  files: TurnFile[];
  added: number;
  removed: number;
  undoneAt: number | null;
  /** The transcript entry that started it, to place its card in the chat */
  transcriptUuid: string | null;
  promptExcerpt: string | null;
}

export interface TurnsResponse {
  turns: Turn[];
  /** Flag `snapshots` on for this session: off, `turns` is empty */
  enabled: boolean;
}

export type UndoRefusal =
  /** The pre snapshot overran its time cap ("Undo not available for this turn") */
  "no_snapshot" | "busy" | "undone" | "not_git" | "running";

/** GET /api/sessions/[id]/turns/[n]: what the undo sheet offers */
export interface TurnDetail {
  /** Files the agent itself touched (checked by default) */
  files: TurnFile[];
  /** The agent's edit-tool paths as recorded */
  touched: string[];
  /** Changed in the turn but not by the agent's edit tools (unchecked) */
  alsoChanged: TurnFile[];
  undoable: boolean;
  reason?: UndoRefusal;
}

/** POST /api/sessions/[id]/turns/[n]/undo (user only; 409 while busy) */
export interface UndoRequest {
  /** The selected files */
  paths: string[];
}

export interface UndoResult {
  reverted: string[];
  kept: { path: string; reason: "changed_since" }[];
}

/** GET /api/sessions/[id]/diff?scope=turn:<n>|branch|uncommitted&file= */
export type DiffScope = `turn:${number}` | "branch" | "uncommitted";

export interface SessionDiff {
  files: ParsedDiff[];
  base: string | null;
  head: string | null;
}
