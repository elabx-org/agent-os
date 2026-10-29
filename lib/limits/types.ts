/**
 * The usage-limit "Limited" state (M6, N-Limited): shapes shared by the
 * server (lib/limits/*, POST /api/sessions/[id]/resume) and the client (Now's
 * Limited section, the chat's LimitedCard, hooks/useSessionLimit.ts). No
 * server imports.
 */

import type { Session } from "../db/types";
import type { QueueItem } from "../queue/types";

/**
 * Which limit it hit: Claude's 5-hour session window, the 7-day week, a
 * model's own week (Opus, Sonnet), or one the screen didn't name
 */
export type LimitKind = "session" | "week" | "opus" | "sonnet" | "unknown";

export const LIMIT_KINDS: readonly LimitKind[] = [
  "session",
  "week",
  "opus",
  "sonnet",
  "unknown",
];

/**
 * What happens at the reset. at_reset: the resume text is queued (kind
 * "resume") for limited_until + RESUME_GRACE_MS, staggered. snooze: nothing
 * is typed; the card leaves Now until the reset. Null: not chosen yet, the
 * card shows Resume at reset / Resume now / Snooze
 */
export type ResumePolicy = "at_reset" | "snooze";

/** POST /api/sessions/[id]/resume */
export type ResumeWhen = "reset" | "now" | "snooze";

export interface ResumeRequest {
  when: ResumeWhen;
  /** Typed at the resume; default DEFAULT_RESUME_TEXT */
  text?: string;
}

/** A session's limit as the UI reads it (limitStateOf) */
export interface LimitState {
  /** Hit a limit that hasn't reset yet (or whose reset is unknown) */
  limited: boolean;
  /** ms */
  limitedAt: number | null;
  /** When it resets (ms); null when no source said */
  limitedUntil: number | null;
  kind: LimitKind | null;
  policy: ResumePolicy | null;
  resumeText: string | null;
}

/** POST and DELETE /api/sessions/[id]/resume */
export interface ResumeResult {
  state: LimitState;
  /** The queued resume item (at_reset, now); null after snooze or cancel */
  item: QueueItem | null;
}

/** The text typed at the resume when none is given */
export const DEFAULT_RESUME_TEXT = "continue";
/** A resume waits this long past the reset */
export const RESUME_GRACE_MS = 30_000;
/** Resumes of different sessions go at least this far apart */
export const RESUME_STAGGER_MS = 20_000;
/** The longest resume text accepted */
export const MAX_RESUME_TEXT = 10_000;

export function isLimitKind(value: unknown): value is LimitKind {
  return typeof value === "string" && LIMIT_KINDS.includes(value as LimitKind);
}

export function isResumePolicy(value: unknown): value is ResumePolicy {
  return value === "at_reset" || value === "snooze";
}

type LimitColumns = Pick<
  Session,
  | "limited_at"
  | "limited_until"
  | "limit_kind"
  | "resume_policy"
  | "resume_text"
>;

/** A session row's limit columns as a LimitState */
export function limitStateOf(
  session: Partial<LimitColumns>,
  now: number = Date.now()
): LimitState {
  const limitedAt = session.limited_at ?? null;
  const limitedUntil = session.limited_until ?? null;
  return {
    limited:
      limitedAt !== null && (limitedUntil === null || now < limitedUntil),
    limitedAt,
    limitedUntil,
    kind:
      limitedAt === null
        ? null
        : isLimitKind(session.limit_kind)
          ? session.limit_kind
          : "unknown",
    policy: isResumePolicy(session.resume_policy)
      ? session.resume_policy
      : null,
    resumeText: session.resume_text ?? null,
  };
}

/** "session limit", "weekly limit", "Opus limit": as the card says it */
export function limitKindLabel(kind: LimitKind | null): string {
  switch (kind) {
    case "session":
      return "session limit";
    case "week":
      return "weekly limit";
    case "opus":
      return "Opus limit";
    case "sonnet":
      return "Sonnet limit";
    default:
      return "usage limit";
  }
}
