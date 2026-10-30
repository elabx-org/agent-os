import type { Terminal as XTerm } from "@xterm/xterm";
import { readClaudeScreen } from "@/lib/claude-screen";

// The box's top rule can carry a label ("─── History 3/14 ───")
const RULE = /^─{3}/;
// Claude's prompt char, then a no-break space; "!" in bash mode
const PROMPT = /^[❯>!]/;
export const squash = (text: string) => text.replace(/\s+/g, "");

/** The rows on screen, as text */
export function screen(term: XTerm) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = buffer.baseY; y < buffer.baseY + term.rows; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines;
}

/** Where Claude's input box starts: its ❯ row, under a rule; -1 if none */
function boxStart(lines: readonly string[]) {
  for (let i = lines.length - 1; i > 0; i--) {
    if (PROMPT.test(lines[i]) && RULE.test(lines[i - 1])) return i;
  }
  return -1;
}

/**
 * The bottom of the screen, where Claude draws its state: from a little
 * above the box down. A transcript line quoting "esc to interrupt" (Claude
 * reading this very file) isn't Claude working.
 */
function bottom(lines: string[]) {
  const start = boxStart(lines);
  return start < 0 ? lines : lines.slice(Math.max(0, start - 14));
}

/** Claude Code is working, or holding messages sent while it works */
export function isClaudeBusy(term: XTerm) {
  const lines = screen(term);
  return (
    bottom(lines).some(
      (line) =>
        line.includes("esc to interru") || line.includes("edit queued messages")
    ) || readClaudeScreen(lines).spinner !== null
  );
}

/** Claude Code is holding messages sent while it works */
export const hasQueued = (term: XTerm) =>
  bottom(screen(term)).some((line) => line.includes("edit queued messages"));

/**
 * What shows of Claude Code's input box: the ❯ line under a rule and the
 * indented lines after it. On a short terminal Claude shows only part of a
 * long input, and the bottom rule and footer may be off screen, so this is
 * only good for comparing with whitespace ignored. Null if there's no box.
 */
export function readClaudePrompt(term: XTerm) {
  const lines = screen(term);
  const start = boxStart(lines);
  if (start < 0) return null;
  const box = [lines[start].replace(PROMPT, "")];
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

/** Claude Code's input box, as read off the screen */
export interface ClaudeBox {
  /** What's typed: wrapped rows joined, hard line breaks as "\n", a bash
      mode box ("! ls") as "!ls". "" when empty. */
  text: string;
  /** Rows of text the box takes */
  rows: number;
  /** Not all of it shows, so text may be missing above, below or to the
      right: as tall as Claude draws a box (a longer input is windowed), cut
      off by the bottom of the screen, or by a window wider than this
      terminal (another client's size) */
  tall: boolean;
  /** The row (from 0) Claude's cursor is on, if it's in the box */
  cursor?: number;
}

/** Most rows Claude shows of its input box; a longer one is windowed */
export const boxWindow = (rows: number) =>
  Math.max(3, Math.floor(rows / 2) - 5);

// East Asian wide characters and emoji take two columns
const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u;
/** Columns a row's text takes */
export const cellWidth = (text: string) => {
  let width = 0;
  for (const char of text)
    width += /[\u{1f3fb}-\u{1f3ff}]/u.test(char) ? 0 : WIDE.test(char) ? 2 : 1;
  return width;
};

const lastWord = (row: string) => row.slice(row.lastIndexOf(" ") + 1);
/** The text up to where a row could have broken: a space, or after a
    wide character (Chinese, Japanese wrap anywhere) */
const firstUnit = (row: string) => {
  const word = row.split(" ", 1)[0];
  const wide = [...word].findIndex((char) => WIDE.test(char));
  return wide < 0 ? word : [...word].slice(0, wide + 1).join("");
};
const wideAt = (text: string, end: boolean) => {
  const chars = [...text];
  return WIDE.test(chars[end ? chars.length - 1 : 0] ?? "");
};

/**
 * How two rows of the box were split. Claude wraps its box at cols - 4: a
 * word that would have fit on the row above means a hard line break; a word
 * longer than a row is broken mid-word (where it runs to the edge, or after
 * a "/" in a URL); wide characters wrap anywhere, without a space; anything
 * else is a word wrap, which took a space. Widths in columns.
 */
export function joinRows(above: string, below: string, width: number) {
  if (!below || below.startsWith(" ")) return "\n";
  const room = cellWidth(above);
  // A little room spare: Claude sometimes wraps a short last word early
  if (room + 1 + cellWidth(firstUnit(below)) <= width - 3) return "\n";
  if (wideAt(above, true) && wideAt(below, false)) return "";
  const word = cellWidth(lastWord(above) + below.split(" ", 1)[0]);
  if (word > width && (room >= width || /[/-]$/.test(above))) return "";
  return " ";
}

/**
 * The size of the tmux pane this terminal shows. With window-size latest a
 * window sized by a smaller client shows in a bigger terminal with tmux's
 * fill: a "│" border and "·" dots to the right, rows of dots below.
 */
export function paneSize(term: XTerm) {
  const buffer = term.buffer.active;
  const dot = (y: number, x: number) =>
    buffer
      .getLine(buffer.baseY + y)
      ?.getCell(x)
      ?.getChars() === "·";
  let rows = term.rows;
  for (let y = 0; y < term.rows; y++) {
    let all = true;
    for (let x = 0; x < term.cols && all; x++) all = dot(y, x);
    if (all) {
      rows = y;
      break;
    }
  }
  let cols = term.cols;
  if (rows > 0 && dot(0, term.cols - 1)) {
    let x = term.cols - 1;
    while (x > 0 && dot(0, x)) x--;
    const border = buffer.getLine(buffer.baseY)?.getCell(x)?.getChars();
    if (border === "│" || border === "┘" || border === "┤") cols = x;
  }
  return { cols, rows };
}

/**
 * Claude Code's input box: the ❯ row under a rule, the rows under it down
 * to the closing rule. Its dim placeholder ("Try …") and hints are left
 * out. Null when there's no box (a menu, a search, a dialog, a shell).
 */
export function readClaudeBox(term: XTerm): ClaudeBox | null {
  const buffer = term.buffer.active;
  const pane = paneSize(term);
  const lines = screen(term)
    .slice(0, pane.rows)
    .map((line) => (pane.cols < term.cols ? line.slice(0, pane.cols) : line));
  const start = boxStart(lines);
  if (start < 0) return null;
  // Indented rows and blank lines down to the closing rule: anything else
  // under the ❯ isn't the box (a picker's selected row, a quote). Off the
  // bottom of a short screen, the rule may not show
  let end = start + 1;
  while (end < lines.length && !RULE.test(lines[end])) {
    if (lines[end] && !lines[end].startsWith("  ")) return null;
    end++;
  }
  let cut = end >= lines.length;
  // Each row's cells: their text, and whether drawn inverse
  const cells: [string, boolean][][] = [];
  let dim = false;
  for (let i = start; i < end; i++) {
    const row = buffer.getLine(buffer.baseY + i);
    if (!row) return null;
    const out: [string, boolean][] = [];
    for (let x = 0; x < pane.cols; x++) {
      const cell = row.getCell(x);
      // The right half of a wide character
      if (!cell || cell.getWidth() === 0) continue;
      if (cell.isDim()) {
        dim = true;
        continue;
      }
      const char = cell.getChars() || " ";
      // Claude keeps the last 2 columns clear: text there is a wider
      // window's, cut off by this terminal
      if (x >= pane.cols - 2 && char !== " ") cut = true;
      out.push([char, !!cell.isInverse()]);
    }
    cells.push(out);
  }
  const rows = cells.map((row, i) => {
    // A cursor drawn over the placeholder isn't typed text
    let text = row
      .filter(([, inverse]) => !dim || !inverse)
      .map(([char]) => char)
      .join("");
    if (!i) {
      const bash = text.startsWith("!");
      text = text.replace(/^[❯>!][ \u00a0]?/, "");
      return ((bash ? "!" : "") + text).trimEnd();
    }
    return text.slice(2).trimEnd();
  });
  const width = pane.cols - 4;
  let text = rows[0];
  for (let i = 1; i < rows.length; i++)
    text += joinRows(rows[i - 1], rows[i], width) + rows[i];
  // Claude's own empty rows under the text (a trailing newline) aside
  text = text.replace(/\n+$/, "");
  const cursor = buffer.cursorY - start;
  return {
    text,
    rows: rows.length,
    tall:
      !!text &&
      (cut || (rows.length > 1 && rows.length >= boxWindow(pane.rows))),
    ...(cursor >= 0 && cursor < rows.length ? { cursor } : {}),
  };
}

/** What's typed in Claude Code's input box (see readClaudeBox) */
export const readClaudeInput = (term: XTerm) =>
  readClaudeBox(term)?.text ?? null;

// Claude numbers a recalled paste anew ("[Pasted text #1 …]" comes back
// as "#2"): compared without the numbers
const PLACEHOLDER = /\[(Pasted text|Image) #\d+/g;
const historyKey = (text: string) => squash(text.replace(PLACEHOLDER, "[$1 #"));

/**
 * The prompt in Claude's history that its box shows, exactly: the screen
 * can't tell a word wrap from a line break, nor show all of a tall box.
 * Placeholders keep the box's numbers. Entries newest first. Null when none
 * matches.
 */
export function fromHistory(box: ClaudeBox, entries: readonly string[]) {
  const key = historyKey(box.text);
  if (!key) return null;
  const found =
    entries.find((e) => historyKey(e) === key) ??
    (box.tall ? entries.find((e) => historyKey(e).includes(key)) : undefined);
  if (found === undefined) return null;
  const numbers = box.text.match(PLACEHOLDER) ?? [];
  // A window of a tall box may not show them all
  if (!numbers.length || numbers.length !== found.match(PLACEHOLDER)?.length)
    return found;
  let i = 0;
  return found.replace(PLACEHOLDER, (p) => numbers[i++] ?? p);
}
