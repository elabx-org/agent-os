/*
 * Claude Code's live state as it draws it at the bottom of the pane, for
 * what its hooks don't say (or say late): the mode right after Shift+Tab,
 * the spinner and messages queued while it works.
 *
 *   · Crunching… (7s · ↓ 88 tokens)          spinner, while it works
 *   ❯ and say bye                            a queued message
 *     ctrl+x ctrl+s to send now
 *   ────────────────────────
 *   ❯                                         the input box
 *   ────────────────────────
 *     ⏸ plan mode on (shift+tab to cycle) · esc to interrupt
 */

export interface ClaudeScreen {
  /**
   * The permission mode in the footer: null when the footer isn't on screen
   * (a prompt or the rewind list covers it, or the pane is too short)
   */
  mode: string | null;
  /** Spinner verb and elapsed time, only while Claude works */
  spinner: { verb: string; elapsed: string | null } | null;
  /** Messages Claude holds until its turn ends, oldest first */
  queued: string[];
  /** Claude says it holds messages, even if their text is off screen */
  hasQueued: boolean;
}

const RULE = /^─{3}/;
const PROMPT = /^[❯>]/;
const SPINNER = /^\s*[·✢✳✶✻✽*]\s+([A-Z][\w-]*)…/;
const ELAPSED = /\((?:[^)]*?·\s*)?((?:\d+h\s*)?(?:\d+m\s*)?\d+s)\b/;

const MODES: [RegExp, string][] = [
  [/plan mode on/i, "plan"],
  [/accept edits on/i, "acceptEdits"],
  [/bypass permissions on/i, "bypassPermissions"],
  [/auto mode on/i, "auto"],
  [/don't ask (mode )?on/i, "dontAsk"],
  // Newer versions name the default mode
  [/(manual|default) mode on/i, "default"],
];

export function readClaudeScreen(lines: readonly string[]): ClaudeScreen {
  const hasQueued = lines.some((l) => l.includes("edit queued messages"));

  // The input box: a ❯ line under a rule, closed by another rule
  let box = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    if (PROMPT.test(lines[i]) && RULE.test(lines[i - 1])) {
      box = i;
      break;
    }
  }
  let mode: string | null = null;
  if (box >= 0) {
    const close = lines.findIndex((l, i) => i > box && RULE.test(l));
    // The footer is the line under the box; without one it's cut off
    const footer = close >= 0 ? lines.slice(close + 1) : [];
    if (footer.length) {
      mode = "default";
      for (const line of footer) {
        const found = MODES.find(([re]) => re.test(line));
        if (found) {
          mode = found[1];
          break;
        }
      }
    }
  }

  // Just above the box, under any queued messages and a tip. A finished
  // turn's line has no ellipsis ("✻ Brewed for 8s"); the footer's "esc to
  // interrupt" can't be relied on, it goes when the pane is narrow.
  let spinner: ClaudeScreen["spinner"] = null;
  const above = box >= 0 ? lines.slice(0, box - 1) : lines;
  for (let i = above.length - 1; i >= above.length - 12 && i >= 0; i--) {
    const m = SPINNER.exec(above[i]);
    if (m) {
      spinner = { verb: m[1], elapsed: ELAPSED.exec(above[i])?.[1] ?? null };
      break;
    }
  }

  // Queued messages sit above the "send now" hint, each a ❯ line with its
  // wrapped lines indented under it. A sent prompt above them looks the
  // same, so only ❯ lines right on top of each other count as more.
  const queued: string[] = [];
  const hint = above.findLastIndex((l) => l.includes("to send now"));
  let parts: string[] = [];
  for (let i = hint - 1; hint > 0 && i >= 0; i--) {
    const line = above[i];
    if (PROMPT.test(line)) {
      parts.unshift(line.replace(PROMPT, "").trim());
      queued.unshift(parts.join(" "));
      parts = [];
      if (!PROMPT.test(above[i - 1] ?? "")) break;
    } else if (line.startsWith("  ") && line.trim() && !queued.length) {
      parts.unshift(line.trim());
    } else break;
  }

  return { mode, spinner, queued, hasQueued };
}
