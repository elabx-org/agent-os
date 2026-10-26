import { proxy, useSnapshot } from "valtio";

export interface Quote {
  id: string;
  text: string;
  /** The chat item it was taken from, if known */
  sourceId?: string;
}

/**
 * Passages quoted to reply to ("Reply to this"), per session. In memory: they
 * survive switching Terminal/Chat, not a reload.
 */
export const replyQuotesStore = proxy<{ bySession: Record<string, Quote[]> }>({
  bySession: {},
});

const EMPTY: readonly Quote[] = [];
let nextId = 0;

export function addQuote(sessionId: string, text: string, sourceId?: string) {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return;
  const list = replyQuotesStore.bySession[sessionId] ?? [];
  // The same passage twice adds nothing
  if (list.some((q) => q.text === clean)) return;
  replyQuotesStore.bySession[sessionId] = [
    ...list,
    { id: `q${++nextId}`, text: clean, sourceId },
  ];
}

export function removeQuote(sessionId: string, id: string) {
  const list = replyQuotesStore.bySession[sessionId];
  if (!list) return;
  const kept = list.filter((q) => q.id !== id);
  if (kept.length) replyQuotesStore.bySession[sessionId] = kept;
  else delete replyQuotesStore.bySession[sessionId];
}

export function clearQuotes(sessionId: string) {
  delete replyQuotesStore.bySession[sessionId];
}

export function useQuotes(
  sessionId: string | null | undefined
): readonly Quote[] {
  const snap = useSnapshot(replyQuotesStore);
  return (sessionId && snap.bySession[sessionId]) || EMPTY;
}

/**
 * The message to send: each quote as a Markdown blockquote ("> " per line,
 * a blank line between quotes), then a blank line and the reply
 */
export function formatWithQuotes(
  quotes: readonly (string | { text: string })[],
  reply: string
): string {
  const blocks = quotes
    .map((q) => (typeof q === "string" ? q : q.text).trim())
    .filter(Boolean)
    .map((text) =>
      text
        .split(/\r\n?|\n/)
        .map((line) => (line.trim() ? `> ${line}` : ">"))
        .join("\n")
    );
  if (!blocks.length) return reply;
  const body = reply.trim();
  return blocks.join("\n\n") + (body ? `\n\n${body}` : "");
}
