/**
 * Resolves a message's attached sessions (M9) into the block typed in
 * front of it (formatAttachmentBlock in lib/session-attach-types.ts). Used
 * by the queue dispatcher when it types an item in (queued and sendNow
 * alike) and by send-keys (the queue flag off), so every path sends the
 * same block.
 */

import { getDb, queries, type Project, type Session } from "./db";
import {
  MAX_SESSION_ATTACHMENTS,
  formatAttachmentBlock,
  type AttachmentBlockEntry,
  type SessionAttachmentRef,
  type SessionSummaryResponse,
} from "./session-attach-types";
import { getSessionSummary } from "./session-summaries";

const MAX_ID = 200;

export interface AttachDeps {
  getSession(id: string): Session | null;
  projectName(session: Session): string | null;
  summary(session: Session): Promise<SessionSummaryResponse>;
}

const realDeps = (): AttachDeps => {
  const db = getDb();
  return {
    getSession: (id) =>
      (queries.getSession(db).get(id) as Session | undefined) ?? null,
    projectName: (session) => {
      if (!session.project_id) return null;
      const project = queries.getProject(db).get(session.project_id) as
        | Project
        | undefined;
      return project && !project.is_uncategorized ? project.name : null;
    },
    summary: (session) => getSessionSummary(session),
  };
};

/** The sessions to attach: no repeats, not the target, known, at most 5 */
export function attachableRefs(
  targetSessionId: string,
  refs: SessionAttachmentRef[],
  getSession: AttachDeps["getSession"]
): Session[] {
  const seen = new Set<string>([targetSessionId]);
  const out: Session[] = [];
  for (const { sessionId } of refs) {
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const session = getSession(sessionId);
    if (session) out.push(session);
    if (out.length >= MAX_SESSION_ATTACHMENTS) break;
  }
  return out;
}

/** resolveAttachmentBlock on given lookups (tests) */
export async function resolveAttachmentBlockWith(
  deps: AttachDeps,
  targetSessionId: string,
  refs: SessionAttachmentRef[]
): Promise<string | null> {
  if (!refs.length) return null;
  const sessions = attachableRefs(targetSessionId, refs, deps.getSession);
  if (!sessions.length) return null;
  const entries: AttachmentBlockEntry[] = await Promise.all(
    sessions.map(async (session) => {
      let summary: string;
      try {
        summary = (await deps.summary(session)).text;
      } catch (error) {
        console.error(`[attach] summary of ${session.id}:`, error);
        summary = "(Its summary could not be built; ask the user about it.)";
      }
      return {
        name: session.name,
        projectName: deps.projectName(session),
        summary,
      };
    })
  );
  return formatAttachmentBlock(entries);
}

/**
 * The block for `refs` sent to `targetSessionId`: missing sessions, the
 * target itself and repeats are left out, at most MAX_SESSION_ATTACHMENTS.
 * Null when nothing is left. A summary that can't be built goes as a
 * one-line note instead of failing the send.
 */
export async function resolveAttachmentBlock(
  targetSessionId: string,
  refs: SessionAttachmentRef[]
): Promise<string | null> {
  if (!refs.length) return null;
  return resolveAttachmentBlockWith(realDeps(), targetSessionId, refs);
}

/**
 * The text that goes in: the undo notice, the attached sessions' block,
 * then the message (and its file paths). Without a block, as before M9
 */
export function composeOutgoing(
  notice: string | null,
  block: string | null,
  message: string
): string {
  if (!block?.trim()) {
    return [notice, message].filter((p) => p && p.trim()).join(" ");
  }
  return [notice, block, message].filter((p) => p && p.trim()).join("\n\n");
}

/** POST bodies' `sessions`: a valid list, or what is wrong with it */
export function parseSessionRefs(
  value: unknown
): SessionAttachmentRef[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "Sessions must be a list";
  if (value.length > MAX_SESSION_ATTACHMENTS) {
    return `At most ${MAX_SESSION_ATTACHMENTS} sessions can be attached`;
  }
  const refs: SessionAttachmentRef[] = [];
  for (const ref of value) {
    const id =
      ref && typeof ref === "object"
        ? (ref as Record<string, unknown>).sessionId
        : undefined;
    if (typeof id !== "string" || !id.trim() || id.length > MAX_ID) {
      return "Each attached session needs a sessionId";
    }
    refs.push({ sessionId: id });
  }
  return refs;
}
