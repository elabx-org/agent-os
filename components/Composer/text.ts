/**
 * The composer's text model. The synced draft always holds the full text that
 * will be sent; the box shows it with long pastes folded into
 * "[Pasted text #n +N lines]" pills, as Claude Code's own input does, and
 * attached images as a pill with a thumbnail, a short name and the size.
 * Folding is display only: expand() turns a pill back into its text, so
 * what's sent never changes.
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

// Uploads from the photo picker, the + menu and pasted images land in
// agent-os-screenshots (app/api/files/upload-temp); the picker's own files
// anywhere. Any absolute path to a picture folds, so every device does it
// the same way
const IMAGE_PATH =
  /(?<=^|\s)(?:~|\/)\S*\.(?:png|jpe?g|gif|webp|heic|heif|bmp)(?=\s|$)/gi;

/** The image paths in a draft, once each, in order */
export function imagePaths(draft: string): string[] {
  return [...new Set([...draft.matchAll(IMAGE_PATH)].map((m) => m[0]))];
}

/**
 * The pictures a change of draft dropped all at once (the box cleared or
 * the text that held them deleted), to offer back; none when any stayed
 */
export function droppedImages(before: string[], after: string[]): string[] {
  if (!before.length || before.some((p) => after.includes(p))) return [];
  return before;
}

/**
 * A sent message's pictures, shown as pictures, and its words without the
 * paths (spaces they leave behind tidied away)
 */
export function splitImages(text: string): { images: string[]; text: string } {
  const images = imagePaths(text);
  if (!images.length) return { images, text };
  const rest = text
    .replace(IMAGE_PATH, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, "")
    .trim();
  return { images, text: rest };
}

// In a reply a path is often in backticks, brackets or ends a sentence
const REPLY_IMAGE =
  /(?<=^|[\s`'"(\[*_])(?:~|\/)[^\s`'"()[\]*]*\.(?:png|jpe?g|gif|webp|bmp)(?=$|[\s`'")\].,;:!?*_])/gim;

/** The pictures a reply names by path, once each, in order */
export function replyImages(text: string): string[] {
  return [...new Set([...text.matchAll(REPLY_IMAGE)].map((m) => m[0]))];
}

/** "IMG_7654" from ".../1730000000000-1a2b3c4d-IMG_7654.jpeg" */
export function imageName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const name = base
    .replace(/^\d{10,}-(?:[0-9a-f]{8}-)?/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, "_")
    // A hyphen could break the pill over two lines
    .replace(/-/g, "\u2011");
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

export function formatSize(bytes: number): string {
  if (bytes >= 900 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Room for the thumbnail: figure spaces, which are about a digit wide and
 * never break, so the pill stays on one line with its picture
 */
export const THUMB_ROOM = "\u2007\u2007\u2007\u00a0";
const NBSP = "\u00a0";

/**
 * An image pill's shown text: the thumbnail's room, "IMG_7654 · 1.2 MB" and
 * an ×, all unbreakable. Its last character is the ×.
 */
export const imageToken = (name: string, size?: number) =>
  THUMB_ROOM +
  name +
  (size === undefined
    ? ""
    : `${NBSP}·${NBSP}${formatSize(size).replace(" ", NBSP)}`) +
  `${NBSP}${NBSP}×`;

/** The draft as shown, with its pills and where they sit */
export function collapse(
  draft: string,
  pastes: Paste[],
  /** An image's size in bytes, once known */
  sizes?: (path: string) => number | undefined
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
  const tokens = new Map<string, string>();
  for (const m of draft.matchAll(IMAGE_PATH)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (!free(from, to)) continue;
    if (!images.includes(m[0])) images.push(m[0]);
    at.push({ from, to });
    const n = images.indexOf(m[0]) + 1;
    let token = imageToken(imageName(m[0]), sizes?.(m[0]));
    // Two pictures named alike still need pills of their own
    const owner = tokens.get(token);
    if (owner !== undefined && owner !== m[0])
      token = imageToken(`${imageName(m[0])}${NBSP}#${n}`, sizes?.(m[0]));
    tokens.set(token, m[0]);
    found.push({ kind: "image", n, text: m[0], token });
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
