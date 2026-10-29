/**
 * The queue UI's pure parts (hooks/useQueue.ts, QueueCard, ComposerCard):
 * optimistic edits of the cached QueueState, the hold captions and the
 * errors in words. No React, so tests/unit/queue-client.test.ts runs them.
 */

import type { HoldReason, QueueItem, QueueState } from "@/lib/queue/types";

/** What the composers see while the queue is off (or not there yet) */
export const QUEUE_OFF: QueueState = {
  items: [],
  notice: null,
  ready: true,
  holdReason: null,
  enabled: false,
};

/** A refused queue request, with the route's error code */
export class QueueRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "QueueRequestError";
  }
}

/** The queue isn't on for this session: the caller sends the old way */
export function isQueueOff(error: unknown): boolean {
  return (
    error instanceof QueueRequestError &&
    (error.code === "queue_off" || error.status === 501)
  );
}

/** A route's refusal in words */
export function queueErrorText(
  status: number,
  body: { error?: string; reason?: string } | null
): string {
  switch (body?.error) {
    case "user_only":
      return body.reason === "no_proof"
        ? "Reload to confirm it's you"
        : "Only you can do this, in Agent-OS";
    case "queue_off":
      return "The queue is off for this session";
    case "not_pending":
      return "Already on its way: it can't be changed now";
    case "not_found":
      return "That message isn't in the queue any more";
  }
  if (body?.error) return body.error;
  if (status === 409) return "Already on its way: it can't be changed now";
  if (status === 404) return "That message isn't in the queue any more";
  return "Couldn't reach the queue";
}

/**
 * Moves an item to a 1-based place among the pending ones (PATCH position).
 * Items being sent stay first; positions are renumbered in the new order
 */
export function moveItem(
  items: readonly QueueItem[],
  itemId: number,
  position: number
): QueueItem[] {
  const sending = items.filter((i) => i.status !== "pending");
  const pending = items.filter((i) => i.status === "pending");
  const from = pending.findIndex((i) => i.id === itemId);
  if (from < 0) return [...items];
  const [moved] = pending.splice(from, 1);
  const to = Math.max(0, Math.min(pending.length, Math.round(position) - 1));
  pending.splice(to, 0, moved);
  return [...sending, ...pending].map((item, i) =>
    item.position === i + 1 ? item : { ...item, position: i + 1 }
  );
}

export function removeItem(
  items: readonly QueueItem[],
  itemId: number
): QueueItem[] {
  return items.filter((i) => i.id !== itemId);
}

export function patchItem(
  items: readonly QueueItem[],
  itemId: number,
  patch: Partial<QueueItem>
): QueueItem[] {
  return items.map((i) => (i.id === itemId ? { ...i, ...patch } : i));
}

/** The server's copy of an item replaces ours, or joins at the end */
export function upsertItem(
  items: readonly QueueItem[],
  item: QueueItem
): QueueItem[] {
  return items.some((i) => i.id === item.id)
    ? items.map((i) => (i.id === item.id ? item : i))
    : [...items, item];
}

/**
 * Where a dragged row lands: the number of other rows whose middle is above
 * the pointer. `mids` are the rows' vertical middles, in order
 */
export function dropIndex(
  mids: readonly number[],
  from: number,
  y: number
): number {
  let index = 0;
  mids.forEach((mid, i) => {
    if (i !== from && mid < y) index++;
  });
  return index;
}

/** The line under the queued messages: when they go, or what holds them */
export function holdCaption(
  holdReason: HoldReason | null,
  agentName: string
): string {
  switch (holdReason) {
    case "asking":
      return `Held: ${agentName} is asking you something. These go once it's answered.`;
    case "permission":
      return `Held: ${agentName} is waiting on a permission answer.`;
    case "typing":
      return "Held: text is half-typed in the terminal";
    case "unknown":
      return `Held until ${agentName}'s screen is clear`;
    case "limited":
      return `Held: ${agentName} hit its usage limit. These go when it resets.`;
    case "paused":
      return "Held while the session is paused";
    default:
      return `Sends when ${agentName} is done. Held while it asks you something.`;
  }
}

/** Queue replaces Send while the session isn't taking messages */
export function holdsSend(state: {
  enabled: boolean;
  ready: boolean;
}): boolean {
  return state.enabled && !state.ready;
}

/** Claude Code's permission modes as the composer's mode pill names them */
export const MODE_PILL: Record<string, string> = {
  acceptEdits: "Accept edits",
  plan: "Plan mode",
  auto: "Auto mode",
  bypassPermissions: "Bypass permissions",
  dontAsk: "Don't ask",
};

/** The card opens for focus, a draft, attachments, the queue or a notice */
export function composerExpanded(parts: {
  focused: boolean;
  text: string;
  attachments: number;
  queued: number;
  notice: boolean;
}): boolean {
  return (
    parts.focused ||
    parts.text !== "" ||
    parts.attachments > 0 ||
    parts.queued > 0 ||
    parts.notice
  );
}

/** The turn an undo notice is about (lib/queue/types.ts undoNoticeText) */
export function turnNoOfNotice(text: string): number | null {
  const m = /undid turn (\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** The notice chip: "Claude will be told turn 4 was undone" */
export function noticeChipText(text: string, agentName: string): string {
  const turn = turnNoOfNotice(text);
  return turn === null
    ? `${agentName} will be told about the undo`
    : `${agentName} will be told turn ${turn} was undone`;
}
