/**
 * Types text into a session's tmux pane through a named paste buffer, using
 * the session's real tmux name (tmuxNameOf), not `${agent_type}-${id}`. As
 * the terminal composer does: a bracketed paste, Enter on its own after it,
 * and Enter again while the text still sits in Claude's idle box.
 */

import { execFile } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Session } from "./db";
import { tmuxNameOf } from "./session-launch";
import { unsentInput } from "./session-ready";

const execFileAsync = promisify(execFile);

export interface SendTextOptions {
  /** Press Enter after the paste (default true) */
  pressEnter?: boolean;
  /**
   * Wait for the looks at Claude's box after the Enter (tests). By default
   * they run on their own, so the caller isn't held up for them
   */
  awaitConfirm?: boolean;
}

/** Runs tmux with these arguments (tests pass their own) */
export type TmuxRunner = (args: string[]) => Promise<unknown>;

const runTmux: TmuxRunner = (args) => execFileAsync("tmux", args);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Between the paste and its Enter, so Claude has taken the paste in */
const ENTER_AFTER_MS = 80;
/** Between looks at Claude's box for text the Enter didn't send */
const CONFIRM_MS = 900;
const CONFIRM_TRIES = 2;

function stdoutOf(result: unknown): string | null {
  const out = (result as { stdout?: unknown } | undefined)?.stdout;
  return typeof out === "string" ? out : null;
}

/** Rejects when the tmux session is gone or a tmux command fails */
export async function sendText(
  session: Session,
  text: string,
  options: SendTextOptions = {},
  run: TmuxRunner = runTmux,
  sleep: (ms: number) => Promise<void> = wait
): Promise<void> {
  const { pressEnter = true, awaitConfirm = false } = options;
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
    // -d drops the buffer once pasted; -p brackets it (when the app asked
    // for that) so a newline in it doesn't submit, -r keeps newlines as LF
    await run(["paste-buffer", "-d", "-p", "-r", "-b", buffer, "-t", pane]);
    loaded = false;
  } finally {
    if (loaded) await run(["delete-buffer", "-b", buffer]).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (!pressEnter) return;
  if (text) await sleep(ENTER_AFTER_MS);
  await run(["send-keys", "-t", pane, "Enter"]);
  if (!text || (session.agent_type || "claude") !== "claude") return;

  // A long paste can still be arriving when the Enter does, and Claude
  // takes the Enter in with it: the text then sits in its box, unsent
  const confirm = async () => {
    for (let i = 0; i < CONFIRM_TRIES; i++) {
      await sleep(CONFIRM_MS);
      const screen = await run(["capture-pane", "-p", "-e", "-t", pane]).catch(
        () => null
      );
      const out = stdoutOf(screen);
      if (out === null || !unsentInput(out.replace(/\n$/, "").split("\n")))
        return;
      await run(["send-keys", "-t", pane, "Enter"]);
    }
  };
  if (awaitConfirm) await confirm();
  else confirm().catch((error) => console.error("[tmux-send] confirm:", error));
}
