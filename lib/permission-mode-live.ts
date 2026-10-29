/**
 * Changing a running session's permission mode: the server side of
 * lib/permission-mode.ts, kept apart because that one is also bundled for
 * the page (providers.ts builds launch flags there).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { Session } from "@/lib/db";
import { readClaudeScreen } from "@/lib/claude-screen";
import { readScreenPrompt } from "@/lib/agent-origin";
import { tmuxNameOf } from "@/lib/session-launch";
import { cycleToMode, normalizeMode, type Mode } from "@/lib/permission-mode";

const execFileAsync = promisify(execFile);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The mode in Claude's footer as it names it; null when it isn't on screen */
async function footerMode(target: string): Promise<string | null> {
  const { stdout } = await execFileAsync("tmux", [
    "capture-pane",
    "-t",
    target,
    "-p",
  ]);
  return readClaudeScreen(stdout.split("\n")).mode;
}

/** What a running Claude session shows now; null if unknown or not running */
export async function readLiveMode(session: Session): Promise<Mode | null> {
  if (session.agent_type !== "claude") return null;
  try {
    return normalizeMode(await footerMode(tmuxNameOf(session)));
  } catch {
    return null;
  }
}

/**
 * Switches a running Claude session's mode without a restart, through its
 * Shift+Tab cycle (bounded, and only while the input box shows, so a key
 * never lands in a dialog). applied=false means it waits for a relaunch.
 */
export async function applyModeLive(
  session: Session,
  mode: Mode
): Promise<{ applied: boolean; live: Mode | null }> {
  if (session.agent_type !== "claude") return { applied: false, live: null };
  const target = tmuxNameOf(session);
  let last: string | null = null;
  try {
    return await cycleToMode(mode, {
      // The footer redraws a moment after the key; wait for it to change.
      // A capture mid-redraw has no footer yet, so that waits too: only a
      // footer still gone after the wait means a dialog covers it
      read: async () => {
        let seen = await footerMode(target);
        for (
          let n = 0;
          last !== null && (seen === last || seen === null) && n < 8;
          n++
        ) {
          await wait(150);
          seen = await footerMode(target);
        }
        last = seen;
        return seen;
      },
      press: async () => {
        await execFileAsync("tmux", ["send-keys", "-t", target, "BTab"]);
      },
    });
  } catch {
    // Not running
    return { applied: false, live: null };
  }
}

/**
 * Answers the permission request on screen "Yes" (its first allow option),
 * as the user's tap on the card would. False when there was none.
 */
export async function allowPendingPrompt(session: Session): Promise<boolean> {
  const target = tmuxNameOf(session);
  const prompt = await readScreenPrompt(target).catch(() => null);
  const option = prompt?.options.find((o) => o.kind === "allow");
  if (!prompt || !option) return false;
  const delta = option.index - prompt.selected;
  const moves = Array(Math.abs(delta)).fill(delta > 0 ? "Down" : "Up");
  if (moves.length) {
    await execFileAsync("tmux", ["send-keys", "-t", target, ...moves]);
    await wait(150);
  }
  await execFileAsync("tmux", ["send-keys", "-t", target, "Enter"]);
  return true;
}
