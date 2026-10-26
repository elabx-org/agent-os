/**
 * The composer's text model. The synced draft always holds the full text that
 * will be sent; the box shows it with long pastes and uploaded images folded
 * into "[Pasted text #n +N lines]" and "[Image #n]" pills, as Claude Code's
 * own input does. Folding is display only: expand() turns a pill back into
 * its text, so what's sent never changes.
 */

export interface Paste {
  n: number;
  text: string;
}

export interface Chip {
  kind: "paste" | "image";
  n: number;
  /** What the pill stands for: the pasted text, or the image's path */
  text: string;
  token: string;
  /** Where the token sits in the displayed text */
  start: number;
  end: number;
}

/** Pastes longer than this many lines become a pill */
export const PASTE_LINES = 8;

export const lineCount = (text: string) => text.split("\n").length;

export const pasteToken = (n: number, text: string) =>
  `[Pasted text #${n} +${lineCount(text)} lines]`;

export const imageToken = (n: number) => `[Image #${n}]`;

// Uploads from the photo picker, the + menu and pasted images all land here
// (app/api/files/upload-temp), so any device folds them the same way
const IMAGE_PATH =
  /(?<=^|\s)\/\S*\/agent-os-screenshots\/\S+\.(?:png|jpe?g|gif|webp|heic|heif)(?=\s|$)/gi;

/** The draft as shown, with its pills and where they sit */
export function collapse(
  draft: string,
  pastes: Paste[]
): { display: string; chips: Chip[] } {
  const found: Omit<Chip, "start" | "end">[] = [];
  const at: { from: number; to: number }[] = [];
  const free = (from: number, to: number) =>
    at.every((r) => to <= r.from || from >= r.to);

  for (const p of pastes) {
    let i = draft.indexOf(p.text);
    while (i >= 0 && !free(i, i + p.text.length))
      i = draft.indexOf(p.text, i + 1);
    if (i < 0) continue;
    at.push({ from: i, to: i + p.text.length });
    found.push({
      kind: "paste",
      n: p.n,
      text: p.text,
      token: pasteToken(p.n, p.text),
    });
  }
  const images: string[] = [];
  for (const m of draft.matchAll(IMAGE_PATH)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (!free(from, to)) continue;
    if (!images.includes(m[0])) images.push(m[0]);
    at.push({ from, to });
    const n = images.indexOf(m[0]) + 1;
    found.push({ kind: "image", n, text: m[0], token: imageToken(n) });
  }

  const order = at.map((r, i) => ({ ...r, chip: found[i] }));
  order.sort((a, b) => a.from - b.from);
  let display = "";
  let last = 0;
  const chips: Chip[] = [];
  for (const { from, to, chip } of order) {
    display += draft.slice(last, from);
    chips.push({
      ...chip,
      start: display.length,
      end: display.length + chip.token.length,
    });
    display += chip.token;
    last = to;
  }
  display += draft.slice(last);
  return { display, chips };
}

/** Pills back to what they stand for: the text that's saved and sent */
export function expand(display: string, chips: Chip[]): string {
  let out = display;
  for (const chip of chips) out = out.split(chip.token).join(chip.text);
  return out;
}

/**
 * Applies an edit of the displayed text so a pill goes or stays whole: a
 * backspace into one removes all of it. Returns the corrected text and caret,
 * or null when the edit didn't touch a pill.
 */
export function keepChipsWhole(
  prev: string,
  next: string,
  chips: Chip[]
): { display: string; caret: number } | null {
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
  let s = 0;
  while (
    s < prev.length - p &&
    s < next.length - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  )
    s++;
  let from = p;
  let to = prev.length - s;
  const inserted = next.slice(p, next.length - s);
  let touched = false;
  for (const c of chips) {
    if (from === to) {
      // Typing inside a pill goes after it
      if (c.start < from && from < c.end) {
        from = to = c.end;
        touched = true;
      }
    } else if (
      c.start < to &&
      c.end > from &&
      !(from <= c.start && to >= c.end)
    ) {
      from = Math.min(from, c.start);
      to = Math.max(to, c.end);
      touched = true;
    }
  }
  if (!touched) return null;
  return {
    display: prev.slice(0, from) + inserted + prev.slice(to),
    caret: from + inserted.length,
  };
}

/** The "/" or "@" word the caret is in, for the pickers */
export function tokenAtCaret(
  display: string,
  caret: number
): { kind: "slash" | "at"; start: number; end: number; query: string } | null {
  let start = caret;
  while (start > 0 && !/\s/.test(display[start - 1])) start--;
  let end = caret;
  while (end < display.length && !/\s/.test(display[end])) end++;
  const word = display.slice(start, caret);
  // A command only at the very start, as Claude Code
  if (start === 0 && word.startsWith("/"))
    return { kind: "slash", start, end, query: word.slice(1) };
  if (word.startsWith("@"))
    return { kind: "at", start, end, query: word.slice(1) };
  return null;
}
