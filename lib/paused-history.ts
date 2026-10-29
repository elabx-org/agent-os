/**
 * A handed-off Codex or Gemini session's terminal history (M4). Its tmux
 * ends at the handoff and it has no transcript, so the last lines of its
 * pane are kept in $AGENT_OS_HOME/handoffs/<session id>.txt for its paused
 * view. Server only.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Session } from "./db";
import { tmuxNameOf } from "./session-launch";
import { cleanScrollback } from "./summarize";

const execFileAsync = promisify(execFile);

const HISTORY_LINES = 3000;
const HISTORY_CHARS = 200_000;
const ID = /^[\w-]{1,64}$/;

function historyFile(sessionId: string): string | null {
  if (!ID.test(sessionId)) return null;
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "handoffs", `${sessionId}.txt`);
}

/** Keeps the pane's last lines; nothing when its tmux is already gone */
export async function savePausedHistory(session: Session): Promise<void> {
  const file = historyFile(session.id);
  if (!file) return;
  const { stdout } = await execFileAsync(
    "tmux",
    [
      "capture-pane",
      "-p",
      "-J",
      "-S",
      `-${HISTORY_LINES}`,
      "-t",
      `=${tmuxNameOf(session)}:`,
    ],
    { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }
  );
  const text = cleanScrollback(stdout, HISTORY_CHARS);
  if (!text) return;
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(file, text, { mode: 0o600 });
}

/** The kept history, or null when there is none */
export function readPausedHistory(sessionId: string): string | null {
  const file = historyFile(sessionId);
  if (!file) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
