/**
 * Quick replies for a question Claude asks in plain text (not through
 * AskUserQuestion): the reply you'd type, offered as taps. Precision over
 * recall: when the shape isn't clear, there are no choices.
 *
 *   A list of options right before the final question:
 *     **A.** Keep it in memory / 1. SQLite table / - **Option B:** …
 *   Alternatives in the question itself:
 *     Want me to keep going on the dock, or pause it and deploy first?
 *   A yes/no question:
 *     Want me to spec + build (b)?  →  Yes / No
 */

export interface MessageChoice {
  /** The tap's words */
  label: string;
  /** What's sent when it's tapped */
  reply: string;
  /** More of the option's text, under the label */
  detail?: string;
}

export interface MessageChoices {
  question: string;
  choices: MessageChoice[];
  kind: "list" | "or" | "yesno";
}

const MAX_LIST = 6;
const MAX_LABEL = 70;

/** Markdown emphasis and code marks off, spaces tidied */
function plain(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max = MAX_LABEL): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// "1. ", "2) ", "A. ", "B) ", "- **A:** ", "**Option A** — ", "- Option B: "
const ITEM =
  /^\s*(?:[-*]\s+)?(?:\*\*)?(?:Option\s+)?(\d{1,2}|[A-F])(?:\*\*)?[.):](?:\*\*)?\s+(.+)$|^\s*(?:[-*]\s+)?\*\*(?:Option\s+)?([A-F])\*\*\s*[—–:-]\s*(.+)$/;

// Words that make a question a choice between the listed things
const CHOOSING = /\b(which|prefer|options?|choose|pick|go with|one of)\b/i;

// Questions that ask for a go-ahead
const YESNO =
  /^(want me to|shall i|should i|do you want|would you like|can i|ok to|okay to|is it ok|is that ok|go ahead|proceed|ready to|happy (for me )?to)\b/i;

/** The last line that holds a question, and its index */
function finalQuestion(lines: string[]): { at: number; text: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    // A question has to end the message (give or take a short sign-off)
    if (!line.includes("?")) {
      if (lines.length - i > 3 || line.length > 80) return null;
      continue;
    }
    // Its last sentence with a question mark
    // (a full stop needs a space after it: ".p12 files" isn't a sentence end)
    const sentences = plain(line).split(/(?<=[.!?:])\s+/);
    const text = sentences.filter((t) => t.endsWith("?")).at(-1);
    return text ? { at: i, text } : null;
  }
  return null;
}

function fromList(lines: string[], at: number, question: string) {
  // The items just above the question (blank lines allowed between)
  const items: { key: string; text: string }[] = [];
  let i = at - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  for (; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) break;
    const m = ITEM.exec(line);
    if (m) {
      items.unshift({ key: m[1] ?? m[3], text: m[2] ?? m[4] });
      continue;
    }
    // An item's wrapped or indented continuation
    if (/^\s{2,}\S/.test(line) && items.length) continue;
    break;
  }
  if (items.length < 2 || items.length > MAX_LIST) return null;
  // In order: 1, 2, 3 or A, B, C
  const keys = items.map((x) => x.key.toUpperCase());
  const first = keys[0];
  const ordered = keys.every((k, n) =>
    /\d/.test(first)
      ? Number(k) === Number(first) + n
      : k.charCodeAt(0) === first.charCodeAt(0) + n
  );
  if (!ordered || (first !== "1" && first !== "A")) return null;
  // Letters say "options"; numbers can be steps, so the question must choose
  if (/\d/.test(first) && !CHOOSING.test(question)) return null;

  return items.map(({ key, text }) => {
    const words = plain(text);
    // "Label — what it means" or "Label: what it means"
    const split = words.match(/^(.{3,60}?)\s*(?:—|–| - |: )\s*(.+)$/);
    const label = clip(split ? split[1] : words);
    return {
      label: `${key}. ${label}`,
      reply: `${key}. ${label.replace(/…$/, "")}`,
      detail: split ? clip(split[2], 140) : undefined,
    };
  });
}

function fromOr(question: string): MessageChoice[] | null {
  // "…, or …?" with a comma before the or: two alternatives
  const body = question.replace(/\?$/, "");
  const parts = body.split(/,\s+or\s+/i);
  if (parts.length !== 2) return null;
  let [a, b] = parts.map((p) => p.trim());
  // "And if so — do you want X" → "do you want X"
  a = a.replace(/^.*\s[—–]\s/, "");
  // Drop the asking words off the first: "Want me to keep going" → "Keep going"
  a = a.replace(
    /^(want me to|shall i|should i|do you want me to|would you like me to|do you want to|would you like to|do you)\s+/i,
    ""
  );
  b = b.replace(
    /^(should i|shall i|do you want me to|want me to|would you rather|are you|do you)\s+/i,
    ""
  );
  if (a.length < 3 || b.length < 3) return null;
  if (a.length > 120 || b.length > 120) return null;
  return [a, b].map((t) => ({
    label: clip(capital(t)),
    reply: capital(t),
  }));
}

/** Choices for the question ending Claude's message, or null */
export function messageChoices(text: string): MessageChoices | null {
  const lines = text.replace(/```[\s\S]*?```/g, "").split("\n");
  const found = finalQuestion(lines);
  if (!found) return null;
  const { at, text: question } = found;

  const list = fromList(lines, at, question);
  if (list) return { question, choices: list, kind: "list" };

  const or = fromOr(question);
  if (or) return { question, choices: or, kind: "or" };

  // "…before or after the commit?" isn't a yes or no
  if (YESNO.test(question) && !/\bor\b/i.test(question)) {
    return {
      question,
      kind: "yesno",
      choices: [
        { label: "Yes", reply: "Yes" },
        { label: "No", reply: "No" },
      ],
    };
  }
  return null;
}
