/**
 * What you're replying to: the question Claude is waiting on, or its last
 * message, kept in view while you type (the context card, the reply sheet,
 * the spread's left page). Built from the transcript, not the screen, so it's
 * the same in Terminal and Chat. Pure: shared by the server and the client.
 */

import type { ChatItem } from "@/lib/claude-transcript";
import type { PermissionPrompt, PromptOption } from "@/lib/permission-prompt";

export type ReplyContextKind = "ask" | "permission" | "message" | "working";

export interface ReplyContextOption {
  /** 1-based, the number shown on the chip (as in Claude Code's menu) */
  index: number;
  label: string;
  description?: string;
  /** The live prompt's option to answer with (useAnswerPrompt); null when
   * the prompt isn't on screen, so the chip can't answer */
  answer: PromptOption | null;
}

export interface ReplyContext {
  kind: ReplyContextKind;
  /** Small-caps label; shown uppercased ("Claude asks · AskUserQuestion") */
  label: string;
  /** The bold line: the question asked, if there is one */
  question: string | null;
  /** A short plain-text excerpt for under the question (Markdown stripped) */
  excerpt: string;
  /** The whole last turn's text, Markdown */
  text: string;
  /** Answer chips for an AskUserQuestion or a permission prompt */
  options: ReplyContextOption[];
  /** The chat item to jump to */
  sourceId: string | null;
  toolName?: string;
  ts: string | null;
  /** A tool call in the turn still without a result (what a permission
   * prompt is about) */
  pendingTool?: string;
}

const MAX_EXCERPT = 280;

/** Markdown to plain lines: code, links, emphasis and markers dropped */
export function stripMarkdown(text: string): string[] {
  return text
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
        .replace(/^\s*\|?\s*:?-{3,}.*$/, "")
        .replace(/\|/g, " ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
        .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

/** Plain sentences, in order; a line break (list item, paragraph) ends one */
export function sentences(text: string): string[] {
  return stripMarkdown(text).flatMap((line) =>
    line
      .split(/(?<=[.!?])\s+(?=\S)/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

const clip = (s: string) =>
  s.length > MAX_EXCERPT ? s.slice(0, MAX_EXCERPT - 1).trimEnd() + "…" : s;

const isQuestion = (s: string) => /\?["')\]]*$/.test(s);

/** The last sentence that asks something, if any */
export function questionOf(text: string): string | null {
  const q = [...sentences(text)].reverse().find(isQuestion);
  return q ? clip(q) : null;
}

/** The final question sentence, else the last two sentences */
export function excerptOf(text: string): string {
  const all = sentences(text);
  const q = [...all].reverse().find(isQuestion);
  return clip(q ?? all.slice(-2).join(" "));
}

/** What leads up to the question (the two sentences before it, else the
 * two after), or the last two sentences without one */
function leadUp(text: string, question: string | null): string {
  const all = sentences(text);
  if (!question) return clip(all.slice(-2).join(" "));
  const at = all.map(clip).lastIndexOf(question);
  if (at < 0) return "";
  const before = all.slice(Math.max(0, at - 2), at);
  return clip((before.length ? before : all.slice(at + 1, at + 3)).join(" "));
}

/**
 * The context of the turn after your last message: a pending AskUserQuestion,
 * else Claude's final text, else (still busy) the text so far. Null when the
 * turn has nothing to show yet.
 */
export function lastTurnContext(items: ChatItem[]): ReplyContext | null {
  let start = items.length;
  while (start > 0 && items[start - 1].kind !== "user") start--;
  const turn = items.slice(start);
  if (!turn.length) return null;

  const answered = new Set(
    turn.flatMap((i) => (i.kind === "result" ? [i.toolUseId] : []))
  );
  const texts = turn.filter(
    (i): i is Extract<ChatItem, { kind: "assistant" }> => i.kind === "assistant"
  );
  const lastText = texts[texts.length - 1];
  const text = texts.map((i) => i.text).join("\n\n");
  const tools = turn.filter(
    (i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool"
  );
  const lastTool = tools[tools.length - 1];
  const pendingTool =
    lastTool && !answered.has(lastTool.id) ? lastTool.name : undefined;

  if (lastTool?.ask && pendingTool) {
    const { ask } = lastTool;
    const lead = lastText
      ? leadUp(lastText.text, questionOf(lastText.text))
      : "";
    return {
      kind: "ask",
      label: "Claude asks · AskUserQuestion",
      question: ask.question,
      excerpt: lead || clip(ask.options.map((o) => o.label).join(" · ")),
      text,
      options: ask.options.map((o, n) => ({
        index: n + 1,
        label: o.label,
        description: o.description,
        answer: null,
      })),
      sourceId: lastTool.id,
      toolName: "AskUserQuestion",
      ts: lastTool.ts || null,
      pendingTool,
    };
  }

  const last = turn[turn.length - 1];
  if (lastText && last.kind === "assistant") {
    const question = questionOf(lastText.text);
    return {
      kind: "message",
      label: "Claude's last message",
      question,
      excerpt: leadUp(lastText.text, question),
      text,
      options: [],
      sourceId: lastText.id,
      ts: lastText.ts || null,
    };
  }

  // Busy: the text so far, or what it's running
  if (!lastText && !lastTool) return null;
  return {
    kind: "working",
    label: "Claude is working",
    question: null,
    excerpt: lastText
      ? excerptOf(lastText.text)
      : clip([lastTool?.name, lastTool?.summary].filter(Boolean).join(": ")),
    text,
    options: [],
    sourceId: (lastText ?? lastTool)?.id ?? null,
    ts: (lastText ?? lastTool)?.ts || null,
    pendingTool,
  };
}

/** The tool a permission prompt's title names ("Bash command" → "Bash") */
function promptTool(prompt: PermissionPrompt): string {
  return prompt.title.split(/\s+/)[0] || "tool";
}

/**
 * Folds in the selection prompt on screen: an AskUserQuestion's options get
 * the prompt's to answer with; any other prompt is a permission request.
 */
export function mergePrompt(
  ctx: ReplyContext | null,
  prompt: PermissionPrompt | null | undefined
): ReplyContext | null {
  if (!prompt) return ctx;

  if (ctx?.kind === "ask") {
    // Claude Code shows each option's description under its label, and the
    // parser joins them: match by the label's start
    const used = new Set<number>();
    const options = ctx.options.map((o) => {
      const live = prompt.options.find(
        (p) => !used.has(p.index) && p.label.startsWith(o.label)
      );
      if (live) used.add(live.index);
      return { ...o, answer: live ?? null };
    });
    return { ...ctx, options };
  }

  const tool = ctx?.pendingTool ?? promptTool(prompt);
  const detail = prompt.detail.split("\n")[0]?.trim();
  const question = detail
    ? clip(`Allow ${tool}: ${detail}?`)
    : prompt.question || prompt.title;
  const choices = prompt.options.map((o) => o.label).join(" · ");
  return {
    kind: "permission",
    label: `Needs permission · ${tool}`,
    question,
    excerpt: clip(
      [prompt.description.replace(/\s+/g, " "), choices]
        .filter(Boolean)
        .join(" ")
    ),
    text: ctx?.text ?? "",
    options: prompt.options.map((o) => ({
      index: o.index + 1,
      label: o.label,
      answer: o,
    })),
    sourceId: ctx?.sourceId ?? null,
    toolName: tool,
    ts: ctx?.ts ?? null,
    pendingTool: ctx?.pendingTool,
  };
}
