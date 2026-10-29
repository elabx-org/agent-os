/**
 * Resuming a limited session (POST/DELETE /api/sessions/[id]/resume).
 * reset: policy at_reset, and a queue item kind "resume" (lib/queue) with
 * not_before = limited_until + RESUME_GRACE_MS, at least RESUME_STAGGER_MS
 * after every other pending resume. now: clears the limit and queues the
 * resume due at once. snooze: policy snooze, nothing queued. The queue item
 * survives a server restart, so a resume goes once. The dispatcher sends a
 * resume only while flag `autoResume` is on, and only when the session is
 * ready (a permission or question on screen holds it). U6.2 implements.
 */

import type { Session } from "../db";
import type { QueueItem } from "../queue/types";
import type { ResumeRequest, ResumeResult } from "./types";

/**
 * When the next resume may go: `until + RESUME_GRACE_MS`, pushed back to
 * RESUME_STAGGER_MS after the latest of `taken` (other pending resumes'
 * not_before) it would come too close to. Pure
 */
export function staggeredResumeAt(
  _until: number,
  _taken: readonly number[]
): number {
  throw new Error("staggeredResumeAt: not implemented (M6 U6.2)");
}

/** Applies a ResumeRequest; throws on a session that isn't limited */
export async function scheduleResume(
  _session: Session,
  _request: ResumeRequest,
  _now?: number
): Promise<ResumeResult> {
  throw new Error("scheduleResume: not implemented (M6 U6.2)");
}

/** Cancels a scheduled resume or a snooze: back to the card */
export function cancelResume(_session: Session): ResumeResult {
  throw new Error("cancelResume: not implemented (M6 U6.2)");
}

/** The session's pending resume item, if any */
export function pendingResume(_sessionId: string): QueueItem | null {
  throw new Error("pendingResume: not implemented (M6 U6.2)");
}

/**
 * One pass: queues the at_reset sessions whose reset became known after
 * they were scheduled. Injected `now` for the clock-mocked tests
 */
export function resumeTick(_now: number = Date.now()): void {
  // M6 U6.2
}

/** Starts the resume pass once (flag autoResume); later calls do nothing */
export function startResumeTicker(): void {
  // M6 U6.2
}
