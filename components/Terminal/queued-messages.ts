import type { Terminal as XTerm } from "@xterm/xterm";

// The box's top rule can carry a label ("─── History 3/14 ───")
const RULE = /^─{3}/;
const squash = (text: string) => text.replace(/\s+/g, "");

function screen(term: XTerm) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = buffer.baseY; y < buffer.baseY + term.rows; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines;
}

/** Claude Code is holding messages sent while it works */
export const hasQueued = (term: XTerm) =>
  screen(term).some((line) => line.includes("edit queued messages"));

/**
 * The text in Claude Code's input box (between the last two rules), or null
 * if there's no box. Wrapped and newline-separated lines look alike, so it's
 * only good for comparing with whitespace ignored.
 */
export function readClaudePrompt(term: XTerm) {
  const lines = screen(term);
  const rules = lines.flatMap((line, i) => (RULE.test(line) ? [i] : []));
  if (rules.length < 2) return null;
  const [top, end] = rules.slice(-2);
  const box = lines.slice(top + 1, end);
  if (!/^[❯>]/.test(box[0] ?? "")) return null;
  return box.join(" ").replace(/^[❯>]/, "");
}

/**
 * The restored text is gone from the prompt. It's cleared from the end, so
 * its start goes last; an empty prompt may show a placeholder instead.
 */
export function isCleared(prompt: string | null, restored: string[]) {
  if (prompt === null) return false;
  const start = squash(restored.join("")).slice(0, 8);
  return !squash(prompt).startsWith(start);
}

/**
 * Which of the composer's recent sends Claude put back in its prompt (Up
 * returns queued messages there, oldest first), or null if the prompt holds
 * something else
 */
export function matchQueued(prompt: string, sends: string[]) {
  const target = squash(prompt);
  if (!target) return null;
  for (let k = sends.length; k > 0; k--) {
    const restored = sends.slice(-k);
    if (squash(restored.join("")) === target) return restored;
  }
  return null;
}
