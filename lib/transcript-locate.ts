/**
 * Finds a Claude session's transcript without a live pane (M4): from the
 * pane when it runs (lib/claude-transcript.ts findTranscript), else from
 * sessions.claude_session_id under <CLAUDE_CONFIG_DIR>/projects/
 * <projectDirFor(cwd)>/, else by that id across the project folders. So a
 * paused (handed-off) chat stays readable.
 */

import type { Session } from "./db";

export interface LocatedTranscript {
  sessionId: string;
  /** null when Claude hasn't written it yet */
  file: string | null;
  cwd: string;
}

export async function locateTranscript(
  _session: Session
): Promise<LocatedTranscript | null> {
  return null; // M4 U1
}
