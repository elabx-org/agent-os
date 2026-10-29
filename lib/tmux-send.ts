/**
 * Types text into a session's tmux pane through a named paste buffer, using
 * the session's real tmux name (tmuxNameOf), not `${agent_type}-${id}`.
 */

import { execFile } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Session } from "./db";
import { tmuxNameOf } from "./session-launch";

const execFileAsync = promisify(execFile);

export interface SendTextOptions {
  /** Press Enter after the paste (default true) */
  pressEnter?: boolean;
}

/** Runs tmux with these arguments (tests pass their own) */
export type TmuxRunner = (args: string[]) => Promise<unknown>;

const runTmux: TmuxRunner = (args) => execFileAsync("tmux", args);

/** Rejects when the tmux session is gone or a tmux command fails */
export async function sendText(
  session: Session,
  text: string,
  options: SendTextOptions = {},
  run: TmuxRunner = runTmux
): Promise<void> {
  const { pressEnter = true } = options;
  const name = tmuxNameOf(session);
  // Exact match: "claude-ab" must not hit "claude-abc". Pane commands need
  // the trailing colon, or tmux reads the target as a window
  await run(["has-session", "-t", `=${name}`]);
  const pane = `=${name}:`;

  // A buffer of its own per send, so two sends never paste each other's text
  const buffer = `send-${session.id}-${randomBytes(4).toString("hex")}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-os-send-"));
  const file = path.join(dir, "text");
  let loaded = false;
  try {
    await fs.writeFile(file, text, { mode: 0o600 });
    await run(["load-buffer", "-b", buffer, file]);
    loaded = true;
    // -d drops the buffer once pasted
    await run(["paste-buffer", "-d", "-b", buffer, "-t", pane]);
    loaded = false;
    if (pressEnter) await run(["send-keys", "-t", pane, "Enter"]);
  } finally {
    if (loaded) await run(["delete-buffer", "-b", buffer]).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
