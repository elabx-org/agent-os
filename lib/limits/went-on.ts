/**
 * Did a limited session go on without its scheduled resume? The user may
 * answer a prompt or type in the terminal after the limit, and a short
 * turn can come and go between two looks of the session watch (no busy
 * edge). The Claude hooks' event log says it: any activity after the
 * limit was recorded. Notifications don't count (Claude's idle reminder
 * comes with nothing done).
 */

import fs from "fs";
import path from "path";
import { claudeStateDir } from "../claude-state";

/** Hook events that only happen when the session does something */
const ACTIVITY = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
]);

/** The last 64 KB of the log is plenty: one turn's events since a limit */
const TAIL_BYTES = 64 * 1024;

/** Activity events in a hook log (events.jsonl lines) after `since` (ms) */
export function activitySince(lines: string[], since: number): boolean {
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as { t?: unknown; event?: unknown };
      if (
        typeof e.t === "number" &&
        e.t > since &&
        typeof e.event === "string" &&
        ACTIVITY.has(e.event)
      )
        return true;
    } catch {
      // a line cut by the tail, or half written
    }
  }
  return false;
}

function tail(file: string): string[] {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    return buf.toString("utf8").split("\n");
  } catch {
    return [];
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** True when the Claude session's hooks recorded activity after `since` */
export function wentOnSince(sessionId: string, since: number): boolean {
  const dir = claudeStateDir(sessionId);
  if (!dir) return false;
  return activitySince(tail(path.join(dir, "events.jsonl")), since);
}
