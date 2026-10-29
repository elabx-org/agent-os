/**
 * Switch a Claude session's model/effort between turns, hand a session off
 * to another agent, and resume a paused one (M4, N-Switch). Server only.
 *
 * Handoff: refused while the source is busy; creates the new session (same
 * project, cwd, worktree, branch), launches it (lib/session-launch.ts),
 * sends the summary (lib/summarize.ts) through the queue once it is ready,
 * and only then marks the source paused_at and ends its tmux (keeping
 * claude_session_id). On any failure the source keeps running, unmarked.
 */

import type { Session } from "./db";
import type {
  HandoffError,
  HandoffPreview,
  HandoffRequest,
  HandoffResult,
  ModelSwitchRequest,
  ModelSwitchResult,
  ResumePausedRequest,
  ResumePausedResult,
} from "./handoff-types";

/** A refusal the routes turn into its status and HandoffError body */
export class HandoffRefused extends Error {
  constructor(
    readonly status: number,
    readonly body: HandoffError
  ) {
    super(body.error);
  }
}

export async function switchModel(
  _session: Session,
  _request: ModelSwitchRequest
): Promise<ModelSwitchResult> {
  throw new Error("Not implemented"); // M4 U2
}

export async function handoff(
  _session: Session,
  _request: HandoffRequest
): Promise<HandoffResult> {
  throw new Error("Not implemented"); // M4 U2
}

export async function handoffPreview(
  _session: Session
): Promise<HandoffPreview> {
  throw new Error("Not implemented"); // M4 U2
}

export async function resumePaused(
  _session: Session,
  _request: ResumePausedRequest
): Promise<ResumePausedResult> {
  throw new Error("Not implemented"); // M4 U2
}
