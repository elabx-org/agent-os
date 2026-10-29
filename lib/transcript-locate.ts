/**
 * Finds a Claude session's transcript without a live pane (M4): from the
 * pane when it runs (lib/claude-transcript.ts findTranscript), else from
 * sessions.claude_session_id under <CLAUDE_CONFIG_DIR>/projects/
 * <projectDirFor(cwd)>/, else by that id across the project folders. So a
 * paused (handed-off) or settled chat stays readable.
 */

import os from "os";
import path from "path";
import type { Session } from "./db";
import { findTranscript, transcriptFileFor } from "./claude-transcript";
import { isEnded } from "./settle-types";
import { tmuxNameOf } from "./session-launch";

export interface LocatedTranscript {
  sessionId: string;
  /** null when Claude hasn't written it yet */
  file: string | null;
  cwd: string;
}

const CLAUDE_SESSION_ID = /^[0-9a-f-]{36}$/;

/** "~" and "~/…" against the home folder */
export function expandHome(dir: string): string {
  if (dir === "~") return os.homedir();
  if (dir.startsWith("~/")) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

/** The folder the session works in: its worktree, else its directory */
export function sessionCwd(
  session: Pick<Session, "worktree_path" | "working_directory">
): string {
  return expandHome(session.worktree_path || session.working_directory || "~");
}

export async function locateTranscript(
  session: Session
): Promise<LocatedTranscript | null> {
  if ((session.agent_type || "claude") !== "claude") return null;

  // A paused or settled session's tmux has ended: no pane to ask
  if (!isEnded(session)) {
    const live = await findTranscript(tmuxNameOf(session));
    if (live) return live;
  }

  const sessionId = session.claude_session_id;
  if (!sessionId || !CLAUDE_SESSION_ID.test(sessionId)) return null;
  const cwd = sessionCwd(session);
  return { sessionId, file: transcriptFileFor(sessionId, cwd), cwd };
}
