/**
 * Claude Code's AskUserQuestion screen, read from the pane, and the keys that
 * answer it (POST /api/sessions/[id]/ask). Recorded on Claude Code 2.1.314
 * (tests/unit/fixtures/ask-screen):
 *
 *   ←  ☐ Storage  ☐ Checks  ✔ Submit  →     one tab per question; one
 *   Where should the cache live?             question shows " ☐ Ship" only
 *   ❯ 1. SQLite table                        single choice: a digit picks
 *        Persist the cache in a table…       and moves on
 *     4. Type something.                     its digit only moves the ❯
 *
 *   ❯ 1. [✔] Unit tests                      several: a digit toggles, the
 *     5. [ ] Type something                  ❯ stays; typing on Other fills
 *        Submit                              it; Enter on Submit moves on
 *
 *   Review your answers … ❯ 1. Submit answers   after the last question
 *
 * Full screen ("tui": "fullscreen") draws a long question with a "│ " bar,
 * and a question taller than the pane loses its tab row (and the start of
 * the question) off the top.
 */

export interface AskRow {
  /** Its number on screen, from 1 */
  n: number;
  label: string;
  /** Several-choice rows only: whether it's ticked */
  checked: boolean | null;
}

export type AskScreen =
  | {
      kind: "question";
      question: string;
      multi: boolean;
      rows: AskRow[];
      /** Where the ❯ is: a row's number, "submit" or null */
      cursor: number | "submit" | null;
      /** The tab row is off the top: the question may be its end only */
      partial?: boolean;
    }
  | { kind: "review"; cursor: number | null };

const TABS = /^\s*(←\s+)?[☐☒✔]\s+\S/;
const ROW = /^(❯|\s)\s(\d+)\.\s(?:\[(.)\]\s)?(.*)$/;
const SUBMIT = /^(❯|\s)\s+Submit\s*$/;
const RULE = /^\s*─{10,}/;
const FOOTER = /Enter to (select|confirm)|Esc to cancel/;
// Full screen's bar beside a long question
const BAR = /^\s*│\s?/;

/**
 * Where a question taller than the pane starts, its tab row gone: the lines
 * above its first row up to a gap or rule, or the top
 */
function headlessStart(lines: string[]): number {
  let footer = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FOOTER.test(lines[i])) {
      footer = i;
      break;
    }
  }
  if (footer < 0) return -1;
  let first = -1;
  for (let i = footer; i >= 0; i--) {
    const row = ROW.exec(lines[i]);
    if (row && row[2] === "1") {
      first = i;
      break;
    }
  }
  if (first < 0) return -1;
  let i = first - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  while (i >= 0 && lines[i].trim() && !RULE.test(lines[i])) i--;
  return i + 1;
}

/** The question screen at the bottom of the pane, or null when there's none */
export function parseAskScreen(lines: string[]): AskScreen | null {
  let tabs = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (TABS.test(lines[i])) {
      tabs = i;
      break;
    }
  }
  const partial = tabs < 0;
  const start = partial ? headlessStart(lines) : tabs + 1;
  if (start < 0) return null;
  // Cut at the top only when nothing above it says where it starts
  const cut = partial && (start === 0 || !RULE.test(lines[start - 1] ?? ""));
  const body = lines.slice(start);
  // The review has no footer; its Submit row says it's still open
  if (
    body.some((l) => /^\s*Review your answers/.test(l)) &&
    body.some((l) => /^(❯|\s)\s\d+\.\s+Submit answers/.test(l))
  ) {
    const row = body.find((l) => /^❯\s\d+\./.test(l));
    const n = row?.match(/^❯\s(\d+)\./)?.[1];
    return { kind: "review", cursor: n ? Number(n) : null };
  }
  // A question has to still be open: its own footer below it
  if (!body.some((l) => FOOTER.test(l))) return null;

  const question: string[] = [];
  const rows: AskRow[] = [];
  let cursor: number | "submit" | null = null;
  let multi = false;
  for (const line of body) {
    if (RULE.test(line)) break;
    const row = ROW.exec(line);
    if (row) {
      const n = Number(row[2]);
      if (row[1] === "❯") cursor = n;
      if (row[3] !== undefined) multi = true;
      rows.push({
        n,
        label: row[4].trim(),
        checked: row[3] === undefined ? null : row[3] !== " ",
      });
      continue;
    }
    const submit = SUBMIT.exec(line);
    if (submit) {
      if (submit[1] === "❯") cursor = "submit";
      continue;
    }
    // The question sits above the first row; descriptions sit under rows
    if (!rows.length && line.trim())
      question.push(line.replace(BAR, "").trim());
  }
  if (!rows.length) return null;
  return {
    kind: "question",
    question: question.join(" "),
    multi,
    rows,
    cursor,
    ...(cut ? { partial: true } : {}),
  };
}

/** Whether the screen shows this question (wrapping and case aside) */
export function isQuestion(screen: AskScreen | null, question: string) {
  if (screen?.kind !== "question") return false;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const shown = norm(screen.question);
  // Its start off the top: the end that shows has to match
  if (screen.partial) return shown.length > 0 && norm(question).endsWith(shown);
  return shown === norm(question);
}

export interface AskAnswer {
  /** The options picked, by index from 0 */
  picks: number[];
  /** "Type something": your own words; empty for none */
  other?: string;
}

export interface AskQuestionSpec {
  question: string;
  multiSelect: boolean;
  /** How many options the tool gave (Other is the row after them) */
  optionCount: number;
}

export interface AskIO {
  read(): Promise<AskScreen | null>;
  /** tmux key names ("Down", "Enter", "3") */
  keys(...keys: string[]): Promise<void>;
  /** Text typed as is */
  type(text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export class AskError extends Error {}

const POLL_MS = 100;
const WAIT_MS = 4000;

async function waitFor(
  io: AskIO,
  ok: (s: AskScreen | null) => boolean,
  what: string
): Promise<AskScreen | null> {
  for (let waited = 0; ; waited += POLL_MS) {
    const screen = await io.read();
    if (ok(screen)) return screen;
    if (waited >= WAIT_MS) throw new AskError(what);
    await io.sleep(POLL_MS);
  }
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Answers every question on Claude's screen, then submits. Each key waits
 * for the screen to show it landed, so nothing is typed anywhere else.
 */
export async function answerAsk(
  io: AskIO,
  questions: AskQuestionSpec[],
  answers: AskAnswer[]
): Promise<void> {
  if (answers.length !== questions.length)
    throw new AskError("One answer per question");

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i];
    const other = oneLine(a.other ?? "");
    const otherRow = q.optionCount + 1;
    if (!a.picks.length && !other) throw new AskError(`No answer for ${i + 1}`);
    if (a.picks.some((p) => p < 0 || p >= q.optionCount))
      throw new AskError("No such option");

    const screen = await waitFor(
      io,
      (s) => isQuestion(s, q.question),
      "Claude isn't showing that question any more"
    );
    if (screen?.kind !== "question") throw new AskError("No question");

    if (!q.multiSelect) {
      if (other) {
        await io.keys(String(otherRow));
        await waitFor(
          io,
          (s) => s?.kind === "question" && s.cursor === otherRow,
          "Couldn't reach Type something"
        );
        await io.type(other);
        await io.keys("Enter");
      } else {
        await io.keys(String(a.picks[0] + 1));
      }
      await waitFor(
        io,
        (s) => !isQuestion(s, q.question),
        "Claude didn't take the answer"
      );
      continue;
    }

    // Several: tick or untick each option to match
    for (let n = 1; n <= q.optionCount; n++) {
      const want = a.picks.includes(n - 1);
      const row = (s: AskScreen | null) =>
        s?.kind === "question" ? s.rows.find((r) => r.n === n) : undefined;
      if (row(await io.read())?.checked === want) continue;
      await io.keys(String(n));
      await waitFor(io, (s) => row(s)?.checked === want, "Couldn't tick it");
    }
    if (other) await moveTo(io, otherRow);
    if (other) await io.type(other);
    await moveTo(io, "submit");
    await io.keys("Enter");
    await waitFor(
      io,
      (s) => !isQuestion(s, q.question),
      "Claude didn't take the answer"
    );
  }

  // Several questions end on a review: its first row submits
  const last = await waitFor(
    io,
    (s) => s === null || s.kind === "review",
    "Claude didn't finish the questions"
  );
  if (last?.kind === "review") {
    await io.keys("1");
    await waitFor(io, (s) => s?.kind !== "review", "Claude didn't submit");
  }
}

/** Moves the ❯ with the arrows to a row or Submit, checking each step */
async function moveTo(io: AskIO, target: number | "submit") {
  for (let step = 0; step < 12; step++) {
    const s = await io.read();
    if (s?.kind !== "question") throw new AskError("The question closed");
    if (s.cursor === target) return;
    const at =
      s.cursor === "submit"
        ? Infinity
        : typeof s.cursor === "number"
          ? s.cursor
          : 0;
    const to = target === "submit" ? Infinity : target;
    await io.keys(at < to ? "Down" : "Up");
    // One step at a time: the next key only once this one shows
    await waitFor(
      io,
      (n) => n?.kind !== "question" || n.cursor !== s.cursor,
      "The cursor didn't move"
    );
  }
  throw new AskError("Couldn't move to it");
}
