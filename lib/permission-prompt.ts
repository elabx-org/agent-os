/**
 * Parses the selection prompt Claude Code shows when it needs you (tool
 * permission, file edit, folder trust) out of a captured tmux pane:
 *
 *   ──────────────────────          block starts at the last full rule
 *    Bash command                   title
 *    Create empty file              description
 *   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *    touch inbox-test.txt           detail (command, diff)
 *   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *    Do you want to proceed?        question
 *    ❯ 1. Yes                       options; ❯ is the cursor, numbers optional,
 *      2. Yes, and always allow       long labels wrap onto deeper lines
 *         access to /path
 *      3. No
 *    Esc to cancel · Tab to amend   footer: the prompt is live
 */

export type PromptOptionKind = "allow" | "always" | "deny" | "other";

export interface PromptOption {
  index: number;
  label: string;
  kind: PromptOptionKind;
}

export interface PermissionPrompt {
  title: string;
  description: string;
  detail: string;
  question: string;
  options: PromptOption[];
  /** Index of the option under the ❯ cursor */
  selected: number;
}

const FOOTER = /(Esc to cancel|Enter to confirm)/;
const RULE = /^\s*─{10,}\s*$/;
const DASHED = /^\s*╌{10,}\s*$/;
const CURSOR = "❯";
/** Option rows start their text at column 3 (" ❯ " or "   ") */
const OPTION_INDENT = 3;
const NUMBERED = /^(\d+)\.\s+/;
const MAX_DETAIL = 600;

function indentOf(line: string): number {
  const m = line.replace(CURSOR, " ").match(/^ */);
  return m ? m[0].length : 0;
}

export function classifyOption(label: string): PromptOptionKind {
  if (/^no\b/i.test(label)) return "deny";
  if (
    /^yes\b.*\b(always|don't ask|allow all|auto-approve|accept edits|auto mode)/i.test(
      label
    )
  )
    return "always";
  if (/^yes\b/i.test(label)) return "allow";
  return "other";
}

/**
 * @param lines captured pane lines (`tmux capture-pane -p`)
 * @param width pane width, to tell hard wraps (mid-word) from word wraps
 */
export function parsePermissionPrompt(
  lines: string[],
  width: number
): PermissionPrompt | null {
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === "") end--;
  // The footer must be the last thing on screen, or the prompt is gone
  let footer = -1;
  for (let i = end; i >= Math.max(0, end - 2); i--) {
    if (FOOTER.test(lines[i])) {
      footer = i;
      break;
    }
  }
  if (footer < 0) return null;

  let start = footer;
  while (start > 0 && !RULE.test(lines[start - 1])) start--;
  const block = lines.slice(start, footer);

  // Options: walk up from the footer while rows are indented like options
  const optionRows: { text: string; cursor: boolean }[] = [];
  let pending: string[] = [];
  let i = block.length - 1;
  for (; i >= 0; i--) {
    const line = block[i];
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (indent > OPTION_INDENT) {
      pending.unshift(line);
      continue;
    }
    if (indent === OPTION_INDENT) {
      optionRows.unshift({
        text: joinWrapped([line, ...pending], width),
        cursor: line.includes(CURSOR),
      });
      pending = [];
      continue;
    }
    break;
  }
  if (optionRows.length < 2) return null;

  const options = optionRows.map((row, index) => {
    const label = row.text.replace(NUMBERED, "");
    return { index, label, kind: classifyOption(label) };
  });
  const selected = Math.max(
    0,
    optionRows.findIndex((r) => r.cursor)
  );

  const body = block.slice(0, i + 1);
  const dashed = body
    .map((l, n) => (DASHED.test(l) ? n : -1))
    .filter((n) => n >= 0);
  const text = (ls: string[]) =>
    paragraphs(ls, width).filter((l) => !/^Tip:/.test(l));

  let header: string[];
  let detail = "";
  let after: string[];
  if (dashed.length >= 2) {
    header = text(body.slice(0, dashed[0]));
    detail = body
      .slice(dashed[0] + 1, dashed[dashed.length - 1])
      .map((l) => l.replace(/^ /, ""))
      .join("\n")
      .replace(/\s+$/, "");
    after = text(body.slice(dashed[dashed.length - 1] + 1));
  } else {
    header = text(body);
    after = [];
  }

  const all = [...header, ...after];
  const question =
    [...after].reverse().find((l) => l.endsWith("?")) ??
    [...all].reverse().find((l) => l.endsWith("?")) ??
    "";
  const title = header[0] ?? question;
  const description = header
    .slice(1)
    .filter((l) => l !== question)
    .join("\n");

  return {
    title,
    description:
      description.length > MAX_DETAIL
        ? description.slice(0, MAX_DETAIL) + "…"
        : description,
    detail:
      detail.length > MAX_DETAIL ? detail.slice(0, MAX_DETAIL) + "…" : detail,
    question,
    options,
    selected,
  };
}

/**
 * A line that runs to the pane edge ending in a long unbroken token (a path,
 * a URL) was cut mid-token; one ending in an ordinary word was word-wrapped.
 */
function isHardWrap(prev: string, width: number): boolean {
  const lastToken = prev.split(/\s/).pop() ?? "";
  return prev.length >= width - 1 && lastToken.length >= 15;
}

/**
 * Regroup wrapped lines into paragraphs: a line continues the previous one
 * when its first word wouldn't have fitted on it.
 */
function paragraphs(lines: string[], width: number): string[] {
  const out: string[] = [];
  let prevRaw: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      prevRaw = null;
      continue;
    }
    if (prevRaw !== null) {
      const prev = prevRaw.replace(/\s+$/, "");
      const firstWord = line.split(/\s/)[0];
      if (isHardWrap(prev, width)) {
        out[out.length - 1] += line;
        prevRaw = raw;
        continue;
      }
      if (prev.length + 1 + firstWord.length > width) {
        out[out.length - 1] += " " + line;
        prevRaw = raw;
        continue;
      }
    }
    out.push(line);
    prevRaw = raw;
  }
  return out;
}

/** Join an option's first row and its continuation rows */
function joinWrapped(rows: string[], width: number): string {
  let out = "";
  rows.forEach((raw, n) => {
    const piece = raw.replace(CURSOR, " ").trim();
    if (n === 0) {
      out = piece;
      return;
    }
    // A row that ran to the pane edge was cut mid-word
    const prev = rows[n - 1].replace(/\s+$/, "");
    out += (isHardWrap(prev, width) ? "" : " ") + piece;
  });
  return out;
}
