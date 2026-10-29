/**
 * A session's summary for a handoff (M4; reused by M5, M8, M9, M11).
 * Extractive by default: the last asks, the conclusions, the files changed
 * (git) and the open plan (lib/claude-plan.ts) from the transcript found by
 * lib/transcript-locate.ts; `claude -p` only when asked and not limited;
 * the pane's scrollback for non-Claude agents.
 */

import type { Session } from "./db";
import type { SessionSummary } from "./handoff-types";

export interface SummarizeOptions {
  /** Condense with `claude -p` (uses quota); default extractive only */
  useModel?: boolean;
}

/** Rough token count of a text, as the sheet shows it */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function buildSummary(
  _session: Session,
  _options: SummarizeOptions = {}
): Promise<SessionSummary> {
  throw new Error("Not implemented"); // M4 U1
}
