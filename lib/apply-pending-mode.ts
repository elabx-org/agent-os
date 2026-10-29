/**
 * Ends a Claude session's tmux so it starts again resuming the same
 * conversation with its stored permission mode (which applies a pending
 * full access). Shared by the restart route (the next attach starts it) and
 * the queue dispatcher (at the idle edge, relaunching it at once).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "./db";
import { readClaudeSessionMeta } from "./claude-transcript";

const execFileAsync = promisify(execFile);

export type StoredModeRestart =
  | { ok: true; session: Session }
  | { ok: false; error: string };

/** The caller checks who asked and that Claude is not mid-turn */
export async function restartWithStoredMode(
  session: Session
): Promise<StoredModeRestart> {
  const db = getDb();
  const id = session.id;
  const target = session.tmux_name || `claude-${id}`;

  // The running conversation, not the newest transcript in the folder
  const meta = await readClaudeSessionMeta(target);
  const claudeSessionId = meta?.sessionId || session.claude_session_id;
  if (!claudeSessionId) {
    return {
      ok: false,
      error: "Couldn't find this session's conversation to resume",
    };
  }
  if (claudeSessionId !== session.claude_session_id) {
    db.prepare(
      "UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(claudeSessionId, id);
  }

  // The relaunch takes permission_mode; its caps are recorded anew
  queries.clearSessionPermissionPending(db).run(id);

  try {
    await execFileAsync("tmux", ["kill-session", "-t", `=${target}`]);
  } catch {
    // Not running: the next attach starts it anyway
  }
  return { ok: true, session: queries.getSession(db).get(id) as Session };
}
