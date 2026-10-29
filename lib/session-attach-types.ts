/**
 * Attaching another session with @ (M9, N-Attach): the shapes shared by the
 * summary route, the queue (lib/queue), the composer and the chat. No
 * server imports.
 *
 * The agent gets a summary of the attached session (lib/summarize.ts,
 * cached in session_summaries, migration 31), never its full transcript.
 * The summary goes in a block in front of the message, resolved when the
 * message is typed in (lib/session-attach.ts), so a queued message carries
 * the summary as it is when it goes, not when it was queued.
 */

import type { SessionSummary } from "./handoff-types";

/** One attached session, as a queue item and POST /queue carry it */
export interface SessionAttachmentRef {
  sessionId: string;
}

/** At most this many sessions on one message */
export const MAX_SESSION_ATTACHMENTS = 5;

/** GET /api/sessions/[id]/summary */
export interface SessionSummaryResponse {
  /** The summary the agent gets (lib/summarize.ts, extractive) */
  text: string;
  /** Rough token count (chars / 4), what the picker and chip show */
  tokens: number;
  /**
   * What the cached summary was built from: the transcript's size and
   * mtime, or the pane's scrollback at a time. A new basis rebuilds it
   */
  basis: string;
  source: SessionSummary["source"];
  /** Nothing to carry over (no transcript, no terminal history) */
  empty: boolean;
}

/**
 * What the composer's direct send (the queue flag off) passes on to
 * POST /api/sessions/[id]/send-keys, which resolves it the same way
 */
export interface DirectSendOptions {
  sessions?: SessionAttachmentRef[];
}

/** A session as the composer holds it before sending: the chip */
export interface AttachedSession {
  sessionId: string;
  name: string;
  /** Null until the summary's size is known */
  tokens: number | null;
}

/** The Sessions tab's status dot and word (N-Attach rows) */
export type AttachableStatus =
  | "needs_you"
  | "working"
  | "idle"
  | "limited"
  | "paused"
  | "settled";

/** One row in the @ popover's Sessions tab */
export interface AttachableSession {
  id: string;
  name: string;
  /** claude | codex | gemini …: the row's avatar letter */
  agentType: string;
  projectName: string | null;
  status: AttachableStatus;
  /** Null until the summary was asked for */
  tokens: number | null;
  /** ms, for the order (most recent first) */
  updatedAt: number;
}

/** One attached session's part of the block, as the dispatcher builds it */
export interface AttachmentBlockEntry {
  name: string;
  projectName: string | null;
  summary: string;
}

const OPEN = /^\[AgentOS: attached session "([^"\n]*)"[^\]\n]*\]\n/;
const close = (name: string) => `[AgentOS: end of attached session "${name}"]`;

/** A name that can't end the block's header early */
const safeName = (name: string) =>
  name.replace(/["\]\n]/g, "'").trim() || "Untitled";

/**
 * The block typed in front of the message, one part per attached session:
 *
 *   [AgentOS: attached session "Stack health check" (komodo-ai-operations), a summary, not its full transcript]
 *   …summary…
 *   [AgentOS: end of attached session "Stack health check"]
 *
 * Empty for no entries. The undo notice (lib/queue/types.ts) still goes
 * first, the user's text after the block
 */
export function formatAttachmentBlock(entries: AttachmentBlockEntry[]): string {
  return entries
    .map((e) => {
      const name = safeName(e.name);
      const where = e.projectName ? ` (${safeName(e.projectName)})` : "";
      return [
        `[AgentOS: attached session "${name}"${where}, a summary, not its full transcript]`,
        e.summary.trim(),
        close(name),
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * A user message as the user typed it: without the attached sessions'
 * block the server put in front (after splitUndoNotice), and their names
 * for the chat's chips
 */
export function splitAttachmentBlock(text: string): {
  text: string;
  attached: string[];
} {
  const attached: string[] = [];
  let rest = text;
  for (;;) {
    const m = OPEN.exec(rest);
    if (!m) break;
    const end = rest.indexOf(close(m[1]), m[0].length);
    if (end < 0) break;
    attached.push(m[1]);
    rest = rest.slice(end + close(m[1]).length).replace(/^\s+/, "");
  }
  return { text: attached.length ? rest : text, attached };
}
