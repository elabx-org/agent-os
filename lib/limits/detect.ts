/**
 * Recognising a usage limit, without reading anything: Claude's limit
 * screen ("You've hit your limit · resets 3:40pm"), its status line's
 * rate_limits at 100%, and which reset time to believe. Pure, so the unit
 * tests feed it recorded screens and statuses. U6.1 implements.
 */

import type { ClaudeStatus } from "../claude-state";
import type { LimitKind } from "./types";

export interface DetectedLimit {
  kind: LimitKind;
  /** ms, null when this source didn't say */
  until: number | null;
}

/**
 * The limit message on the bottom of a screen (ANSI already stripped), with
 * its reset time read against `now` (local time, rolling to the next day
 * when the time has passed). Null when the screen shows no limit
 */
export function parseLimitScreen(
  _lines: readonly string[],
  _now: Date
): DetectedLimit | null {
  throw new Error("parseLimitScreen: not implemented (M6 U6.1)");
}

/**
 * A rate limit at 100% in Claude's status line (`rate_limits.*`
 * used_percentage >= 100), with its resets_at (epoch seconds) as ms. Null
 * when none is full
 */
export function limitFromStatus(
  _rateLimits: ClaudeStatus["rate_limits"]
): DetectedLimit | null {
  throw new Error("limitFromStatus: not implemented (M6 U6.1)");
}

/**
 * The reset to believe, in order: the status line's resets_at, the usage
 * API's resets_at for that kind, the time parsed from the screen
 */
export function resolveUntil(_sources: {
  status?: number | null;
  usage?: number | null;
  screen?: number | null;
}): number | null {
  throw new Error("resolveUntil: not implemented (M6 U6.1)");
}
