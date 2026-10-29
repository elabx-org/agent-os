/**
 * The pure rules behind attaching another session with @ (M9, N-Attach):
 * token counts as the rows and footer say them, a row's status, the
 * Sessions tab's list and the chips. No React, no fetches.
 */

import type { Session } from "@/lib/db/types";
import { isLimitShown } from "@/lib/limits/types";
import {
  MAX_SESSION_ATTACHMENTS,
  type AttachableSession,
  type AttachableStatus,
  type AttachedSession,
  type SessionAttachmentRef,
} from "@/lib/session-attach-types";

/** The Sessions tab shows at most this many rows */
export const MAX_ATTACHABLE_ROWS = 30;
/** Summaries are asked for only for the first rows */
export const SUMMARY_ROWS = 10;

/** "850 tokens", "1.2k tokens", "2k tokens", "12k tokens" */
export function formatTokens(n: number): string {
  const count = Math.max(0, Math.round(n));
  if (count === 1) return "1 token";
  if (count < 1000) return `${count} tokens`;
  if (count < 9950) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, "");
    return `${k}k tokens`;
  }
  return `${Math.round(count / 1000)}k tokens`;
}

/**
 * The footer beside +: "Adds 1 session · 1.2k tokens". The count alone
 * while a summary's size isn't known yet; empty with nothing attached
 */
export function attachFooter(attached: AttachedSession[]): string {
  if (!attached.length) return "";
  const n = attached.length;
  const head = `Adds ${n} session${n === 1 ? "" : "s"}`;
  if (attached.some((a) => a.tokens === null)) return head;
  const total = attached.reduce((sum, a) => sum + (a.tokens ?? 0), 0);
  return `${head} · ${formatTokens(total)}`;
}

/** The fields a row's status reads, settled_at once M8 adds it */
export type StatusFields = Partial<
  Pick<
    Session,
    | "paused_at"
    | "limited_at"
    | "limited_until"
    | "limit_kind"
    | "resume_policy"
    | "resume_text"
  >
> & { settled_at?: number | string | null };

/**
 * A row's dot and word: settled (M8), paused (M4 handoff), limited (M6),
 * else what the live status says (waiting → needs you, running → working)
 */
export function attachableStatus(
  session: StatusFields,
  live: string | undefined,
  now: number = Date.now()
): AttachableStatus {
  if (session.settled_at) return "settled";
  if (session.paused_at) return "paused";
  if (isLimitShown(session, now)) return "limited";
  if (live === "waiting") return "needs_you";
  if (live === "running") return "working";
  return "idle";
}

/**
 * The Sessions tab's rows: never the session typed in, matching `query`
 * on the name or the project, most recent first, capped
 */
export function filterAttachable(
  rows: AttachableSession[],
  currentId: string | null,
  query: string,
  max: number = MAX_ATTACHABLE_ROWS
): AttachableSession[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter((r) => r.id !== currentId)
    .filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.projectName ?? "").toLowerCase().includes(q)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

/**
 * The typed "@query" taken out of the text once its session is a chip:
 * the text and where the caret goes. A space left doubled closes up.
 */
export function removeAtToken(
  text: string,
  token: { start: number; end: number }
): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  let after = text.slice(token.end);
  if ((before === "" || /\s$/.test(before)) && after.startsWith(" "))
    after = after.slice(1);
  return { text: before + after, caret: before.length };
}

export type ToggleResult =
  | { list: AttachedSession[]; change: "attached" | "detached" }
  | { list: AttachedSession[]; change: "full" };

/**
 * Tapping a row: attach it, or detach it when it's on already. At
 * MAX_SESSION_ATTACHMENTS nothing changes and the caller says why
 */
export function toggleAttached(
  list: AttachedSession[],
  session: Pick<AttachableSession, "id" | "name" | "tokens">,
  max: number = MAX_SESSION_ATTACHMENTS
): ToggleResult {
  if (list.some((a) => a.sessionId === session.id))
    return {
      list: list.filter((a) => a.sessionId !== session.id),
      change: "detached",
    };
  if (list.length >= max) return { list, change: "full" };
  return {
    list: [
      ...list,
      { sessionId: session.id, name: session.name, tokens: session.tokens },
    ],
    change: "attached",
  };
}

/** What POST /queue and send-keys carry */
export function sessionRefs(
  attached: AttachedSession[]
): SessionAttachmentRef[] {
  return attached.map((a) => ({ sessionId: a.sessionId }));
}

/** A saved chip list, from localStorage; anything odd is dropped */
export function parseAttached(raw: string | null): AttachedSession[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (a): a is AttachedSession =>
          !!a &&
          typeof a === "object" &&
          typeof (a as AttachedSession).sessionId === "string" &&
          typeof (a as AttachedSession).name === "string"
      )
      .map((a) => ({
        sessionId: a.sessionId,
        name: a.name,
        tokens: typeof a.tokens === "number" ? a.tokens : null,
      }))
      .slice(0, MAX_SESSION_ATTACHMENTS);
  } catch {
    return [];
  }
}
