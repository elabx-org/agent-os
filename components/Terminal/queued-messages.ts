import type { Terminal as XTerm } from "@xterm/xterm";
import { readClaudeScreen } from "@/lib/claude-screen";

// The box's top rule can carry a label ("─── History 3/14 ───")
const RULE = /^─{3}/;
const squash = (text: string) => text.replace(/\s+/g, "");

/** The rows on screen, as text */
export function screen(term: XTerm) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = buffer.baseY; y < buffer.baseY + term.rows; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines;
}

/** Claude Code is working, or holding messages sent while it works */
export function isClaudeBusy(term: XTerm) {
  const lines = screen(term);
  return (
    lines.some(
      (line) =>
        line.includes("esc to interru") || line.includes("edit queued messages")
    ) || readClaudeScreen(lines).spinner !== null
  );
}

/** Claude Code is holding messages sent while it works */
export const hasQueued = (term: XTerm) =>
  screen(term).some((line) => line.includes("edit queued messages"));

/**
 * What shows of Claude Code's input box: the ❯ line under a rule and the
 * indented lines after it. On a short terminal Claude shows only part of a
 * long input, and the bottom rule and footer may be off screen, so this is
 * only good for comparing with whitespace ignored. Null if there's no box.
 */
export function readClaudePrompt(term: XTerm) {
  const lines = screen(term);
  let start = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    if (/^[❯>]/.test(lines[i]) && RULE.test(lines[i - 1])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const box = [lines[start].replace(/^[❯>]/, "")];
  for (const line of lines.slice(start + 1)) {
    if (RULE.test(line) || line.includes("⏵⏵") || !line.startsWith("  ")) break;
    box.push(line);
  }
  return squash(box.join(""));
}

/** The prompt shows (part of) the messages Claude put back */
export function showsQueued(prompt: string | null, queued: string[]) {
  return !!prompt && squash(queued.join("")).includes(prompt);
}

/**
 * What's typed in Claude Code's input box, as text: its dim placeholder
 * ("Try …") left out, wrapped rows joined with the space a word wrap took
 * (none where a long word ran to the edge). "" when empty, null when
 * there's no box (a menu, a shell).
 */
export function readClaudeInput(term: XTerm): string | null {
  const buffer = term.buffer.active;
  const lines = screen(term);
  let start = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    if (/^[❯>]/.test(lines[i]) && RULE.test(lines[i - 1])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const rows: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i > start && (RULE.test(line) || !line.startsWith("  "))) break;
    const row = buffer.getLine(buffer.baseY + i);
    if (!row) break;
    let text = "";
    for (let x = 0; x < term.cols; x++) {
      const cell = row.getCell(x);
      if (!cell || cell.isDim()) continue;
      text += cell.getChars() || " ";
    }
    rows.push(text.replace(/^(?:[❯>] ?| {2})/, "").trimEnd());
  }
  let out = "";
  for (const [i, row] of rows.entries()) {
    if (!i) out = row;
    else if (!row) continue;
    else {
      // A word wrap drops the space; a long word just runs on
      const full = rows[i - 1].length >= term.cols - 3;
      out += (full ? "" : " ") + row;
    }
  }
  return out.trim();
}
