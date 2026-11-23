/**
 * Claude's "trust this folder?" screen, and saying yes to it. Which answer
 * the cursor starts on differs between Claude versions (2.1.330 starts on
 * "No, exit", where Enter quits Claude), so Enter alone is never sent: the
 * cursor is moved to Yes, seen there, and only then confirmed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The screen itself (lib/session-ready.ts CLAUDE_DIALOGS) */
export const TRUST_SCREEN =
  /trust (the files in |the contents of )?this (folder|directory|project)|Is this a project you created or one you trust/i;

/** One of its answers: "❯ 1. Yes, proceed", "  No, exit", "│ ❯ Yes, I trust…" */
const OPTION = /^[\s│|]*(?:([❯›>])\s*)?(?:\d+[.)]\s*)?(Yes|No)\b/;

/**
 * The keys that put the cursor on Yes: none when it is there already, null
 * when the answers or the cursor can't be found
 */
export function keysToYes(screen: string): string[] | null {
  const options = screen
    .split("\n")
    .map((line) => OPTION.exec(line))
    .filter((m): m is RegExpExecArray => m !== null);
  const yes = options.findIndex((m) => m[2] === "Yes");
  const cursor = options.findIndex((m) => !!m[1]);
  if (yes < 0 || cursor < 0) return null;
  return Array<string>(Math.abs(yes - cursor)).fill(
    yes > cursor ? "Down" : "Up"
  );
}

export interface TrustPane {
  /** The pane's text now */
  read(): Promise<string>;
  press(key: string): Promise<void>;
  wait(ms: number): Promise<void>;
}

/**
 * Says yes on the trust screen. False when the screen isn't up, or the
 * cursor couldn't be seen on Yes: then nothing is confirmed and it is left
 * for the user
 */
export async function answerTrust(pane: TrustPane): Promise<boolean> {
  const bottom = async () =>
    (await pane.read()).trimEnd().split("\n").slice(-20).join("\n");
  const first = await bottom();
  if (!TRUST_SCREEN.test(first)) return false;
  const keys = keysToYes(first);
  if (keys === null) return false;
  for (const key of keys) {
    await pane.press(key);
    await pane.wait(120);
  }
  // The screen redraws a moment after the key
  for (let i = 0; keys.length > 0 && i < 6; i++) {
    const moved = await bottom();
    if (TRUST_SCREEN.test(moved) && keysToYes(moved)?.length === 0) break;
    if (i === 5) return false;
    await pane.wait(200);
  }
  await pane.press("Enter");
  return true;
}

/** A tmux pane (a target like "=name:") as answerTrust reads and presses it */
export function tmuxTrustPane(target: string): TrustPane {
  return {
    read: async () =>
      String(
        (await execFileAsync("tmux", ["capture-pane", "-p", "-t", target]))
          .stdout
      ),
    press: async (key) => {
      await execFileAsync("tmux", ["send-keys", "-t", target, key]);
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
