/**
 * The server message queue's shapes, shared by the API routes
 * (app/api/sessions/[id]/queue) and the client (hooks/useQueue.ts). No
 * server imports.
 */

export type QueueOrigin = "user" | "system" | "agent";

/**
 * message: text to type in. command: a slash command or mode change, sent
 * only while idle. resume: M6's "continue" after a limit. undo_notice: never
 * sent alone, merged as a prefix into the next outgoing message
 */
export type QueueKind = "message" | "command" | "resume" | "undo_notice";

export type QueueStatus =
  | "pending"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed";

/**
 * Why a session isn't taking a message now (lib/session-ready.ts).
 * busy: working. asking: a question, plan approval, trust screen or picker.
 * permission: a permission prompt. typing: text half-typed in its input
 * line. unknown: a screen it can't classify (fail closed). limited, paused:
 * M6 / M4
 */
export type HoldReason =
  | "busy"
  | "asking"
  | "permission"
  | "typing"
  | "unknown"
  | "limited"
  | "paused";

export interface QueueItem {
  id: number;
  sessionId: string;
  position: number;
  text: string;
  /** File paths sent after the text */
  attachments: string[];
  origin: QueueOrigin;
  kind: QueueKind;
  status: QueueStatus;
  /** Not sent before this time (ms), e.g. a limit's reset */
  notBefore: number | null;
  createdAt: number;
  sentAt: number | null;
  error: string | null;
}

/** GET /api/sessions/[id]/queue */
export interface QueueState {
  /** Pending and sending items, by position; never the undo notice */
  items: QueueItem[];
  /**
   * Messages that didn't go (a tmux error, or cut off by a restart) in the
   * last day and not dismissed, oldest first, each with its error
   */
  failed: QueueItem[];
  /**
   * The pending undo notice the next message carries, if any. Also with the
   * queue off: the old send prefixes it too
   */
  notice: QueueItem | null;
  ready: boolean;
  holdReason: HoldReason | null;
  /**
   * The queue path is on for this session (flag `queue`, or the session is
   * in the per-session override). Off: the composers keep their old
   * client-side send, and the other fields are empty
   */
  enabled: boolean;
}

/** POST /api/sessions/[id]/queue */
export interface EnqueueRequest {
  text: string;
  attachments?: string[];
  /** Default message; agents may only send messages */
  kind?: Extract<QueueKind, "message" | "command">;
  /**
   * Send now if the session is ready and nothing is pending ahead of it
   * (decided on the server, under the dispatcher's lock); otherwise queue
   */
  sendNow?: boolean;
}

export interface EnqueueResult {
  item: QueueItem;
  /** True when it went straight in; false when it waits in the queue */
  sent: boolean;
}

/** PATCH /api/sessions/[id]/queue/[itemId]: only while pending */
export interface EditQueueItemRequest {
  text?: string;
  /** The new 1-based place among the pending items */
  position?: number;
}

export interface EditQueueItemResult {
  item: QueueItem;
}

/** The notice prefixed to the next message after an undo (lib/turns.ts) */
export function undoNoticeText(turnNo: number, paths: string[]): string {
  const files = paths.length ? paths.join(", ") : "its files";
  return `[AgentOS: the user undid turn ${turnNo}; ${files} ${paths.length === 1 ? "is" : "are"} back to how ${paths.length === 1 ? "it was" : "they were"} before it. Re-read them before editing.]`;
}

/**
 * Whether a message can carry the undo notice: not a slash command, a `!`
 * shell line or a `#` memory line, which the notice in front would turn
 * into a plain prompt. Those go as they are and the notice waits
 */
export function takesNotice(text: string): boolean {
  return !/^[/!#]/.test(text.trimStart());
}

/** A sent message's leading undo notice, which the chat doesn't show */
const NOTICE_PREFIX = /^\[Agent-?OS: the user undid turn (\d+);[^\]]*\]\s*/;

/**
 * A user message as the user typed it: without the undo notice the server
 * put in front, and the turn that notice was about
 */
export function splitUndoNotice(text: string): {
  text: string;
  undoneTurn: number | null;
} {
  const m = NOTICE_PREFIX.exec(text);
  return m
    ? { text: text.slice(m[0].length), undoneTurn: Number(m[1]) }
    : { text, undoneTurn: null };
}
