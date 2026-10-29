/**
 * A session's summary for @ attach (M9), cached in session_summaries
 * (migration 31): lib/summarize.ts buildSummary (extractive, never
 * `claude -p`), rebuilt when its basis changes (the transcript's size or
 * mtime for Claude, the pane's scrollback for other agents). Works for a
 * paused or ended session through lib/transcript-locate.ts.
 */

import type { Session } from "./db";
import type { SessionSummaryResponse } from "./session-attach-types";

export interface SessionSummaryOptions {
  /** Rebuild even when the cached basis still matches */
  fresh?: boolean;
}

/**
 * What the summary would be built from now: a new value means the cached
 * one is stale (e.g. "t:<size>:<mtimeMs>" for a transcript)
 */
export async function summaryBasis(_session: Session): Promise<string> {
  throw new Error("Not implemented"); // M9 U1
}

/** The cached summary when its basis still matches, else a new one stored */
export async function getSessionSummary(
  _session: Session,
  _options: SessionSummaryOptions = {}
): Promise<SessionSummaryResponse> {
  throw new Error("Not implemented"); // M9 U1
}

/** Drops a session's cached summary (on session delete) */
export function forgetSessionSummary(_sessionId: string): void {
  // M9 U1
}
