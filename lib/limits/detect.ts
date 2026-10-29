/**
 * Recognising a usage limit, without reading anything: Claude's limit
 * screen ("You've hit your session limit · resets 3:40pm (UTC)"), its status
 * line's rate_limits at 100%, and which reset time to believe. Pure, so the
 * unit tests feed it recorded screens and statuses.
 */

import type { ClaudeStatus } from "../claude-state";
import type { UsageBlock, UsageResponse } from "../claude-usage";
import type { LimitKind } from "./types";

export interface DetectedLimit {
  kind: LimitKind;
  /** ms, null when this source didn't say */
  until: number | null;
}

const DAY_MS = 24 * 60 * 60_000;

/*
 * The messages, as Claude has drawn them:
 *   ⏺ You've hit your session limit · resets 12am (UTC)
 *   ⎿  You've hit your limit · resets 3:40pm (Europe/London)
 *   5-hour limit reached ∙ resets 3pm
 *   Opus weekly limit reached ∙ resets Oct 9, 6pm
 *   Claude usage limit reached. Your limit will reset at 3pm (America/New_York).
 * Not "Approaching usage limit · resets at 10pm", which is only a warning.
 */
const WHICH =
  "(?:(5-hour|session|weekly|week|(?:opus|sonnet)(?: weekly)?|usage) )";
const HIT = new RegExp(
  `\\byou(?:'|’)ve hit your ${WHICH}?limit\\b|\\b${WHICH}limit reached\\b|\\byou(?:'|’)re out of (?:extra )?usage\\b`,
  "i"
);
/*
 * In the turn's own lines the message starts its line (after Claude's ⏺ or
 * ⎿): an assistant reply or tool output that quotes it mid-line is not a
 * limit. The footer under the input box is Claude's own, so it may sit
 * anywhere on its line
 */
const LINE_HIT = new RegExp(
  `^\\s*(?:[⏺⎿●]\\s*)*(?:claude )?(?:${HIT.source})`,
  "i"
);
const WARNING = /\bapproaching\b/i;
const RESET = /\breset(?:s)?\b(?:\s+at)?\s+(.*)$/i;
const ZONE = /\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\)|\b(UTC|GMT)\s*$/;

/** The user's line, the agent's and the input box end a message */
const PROMPT = /^\s*[❯>]/;
const RULE = /^─{3}/;
const BULLET = /^\s*⏺/;
/** How far up from the input box (or the bottom) a message counts */
const REACH = 15;

function kindOf(word: string | undefined): LimitKind {
  const w = (word ?? "").toLowerCase();
  if (w.startsWith("opus")) return "opus";
  if (w.startsWith("sonnet")) return "sonnet";
  if (w === "session" || w === "5-hour") return "session";
  if (w === "weekly" || w === "week" || w === "7-day") return "week";
  return "unknown";
}

/** The lines a current limit message can be on, nearest first */
function candidates(lines: readonly string[]): Candidate[] {
  let box = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    if (PROMPT.test(lines[i]) && RULE.test(lines[i - 1])) {
      box = i;
      break;
    }
  }
  const out: Candidate[] = [];
  const join = (i: number) =>
    i + 1 < lines.length ? `${lines[i]} ${lines[i + 1].trim()}` : lines[i];

  if (box >= 0) {
    // The footer under the box shows the limit as a notice too
    const close = lines.findIndex((l, i) => i > box && RULE.test(l));
    if (close >= 0) {
      for (let i = close + 1; i < lines.length; i++)
        out.push({ text: join(i), footer: true });
    }
  }
  // Up from the box to the turn's last bullet or prompt: anything above
  // that is an earlier part of the turn (a tool's output, a reply) or an
  // earlier turn, so the message there is not this turn's end
  const end = box >= 0 ? box - 1 : lines.length;
  for (let i = end - 1; i >= 0 && i >= end - REACH; i--) {
    const line = lines[i];
    if (!line.trim() || RULE.test(line)) continue;
    // A narrow pane wraps the message: try it with the line under it
    out.push({ text: i + 1 < end ? join(i) : line, footer: false });
    if (PROMPT.test(line) || BULLET.test(line)) break;
  }
  return out;
}

interface Candidate {
  text: string;
  /** Under the input box: Claude's own footer */
  footer: boolean;
}

/**
 * The limit message on the bottom of a screen (ANSI already stripped), with
 * its reset time read against `now` (local time, rolling to the next day
 * when the time has passed). Null when the screen shows no limit
 */
export function parseLimitScreen(
  lines: readonly string[],
  now: Date
): DetectedLimit | null {
  for (const { text: line, footer } of candidates(lines)) {
    const hit = (footer ? HIT : LINE_HIT).exec(line);
    if (!hit || WARNING.test(line)) continue;
    const kind = kindOf(hit[1] ?? hit[2]);
    const reset = RESET.exec(line.slice(hit.index));
    return { kind, until: reset ? parseReset(reset[1], now) : null };
  }
  return null;
}

// ---- reset times ----------------------------------------------------------

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

interface Parts {
  y: number;
  m: number;
  d: number;
  weekday: number;
}

function validZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The calendar date at `ms` in `zone` (local when null) */
function dateIn(ms: number, zone: string | null): Parts {
  if (!zone) {
    const d = new Date(ms);
    return {
      y: d.getFullYear(),
      m: d.getMonth(),
      d: d.getDate(),
      weekday: d.getDay(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return {
    y: Number(get("year")),
    m: Number(get("month")) - 1,
    d: Number(get("day")),
    weekday: WEEKDAYS.indexOf((get("weekday") ?? "").toLowerCase()),
  };
}

/** How far `zone` is ahead of UTC at `ms` */
function offsetAt(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time in `zone` (local when null) as ms; days may overflow */
function wallTime(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  zone: string | null
): number {
  if (!zone) return new Date(y, m, d, h, min).getTime();
  const guess = Date.UTC(y, m, d, h, min);
  const first = guess - offsetAt(guess, zone);
  // Again at the result, in case a DST change lies between
  return guess - offsetAt(first, zone);
}

/**
 * "3:40pm", "12am", "18:00", "Oct 9, 6pm", "Thu 6pm", "2026-10-09 18:00",
 * "in 2h 15m", each with an optional "(Zone/Name)": the next such moment
 * after `now`, as ms. Null when it can't be read
 */
export function parseReset(text: string, now: Date): number | null {
  const named = ZONE.exec(text);
  const zone = validZone(named?.[1] ?? named?.[2]);
  const body = text.replace(ZONE, " ").replace(/[.,]?\s*$/, "");
  const nowMs = now.getTime();

  const rel =
    /^\s*in\s+(?:(\d+)\s*d\w*)?\s*(?:(\d+)\s*h\w*)?\s*(?:(\d+)\s*m\w*)?/i.exec(
      body
    );
  if (rel && (rel[1] || rel[2] || rel[3])) {
    const [d, h, m] = [rel[1], rel[2], rel[3]].map((v) => Number(v ?? 0));
    return nowMs + ((d * 24 + h) * 60 + m) * 60_000;
  }

  const time =
    /(?:^|[\s,])(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(body) ??
    /(?:^|[\s,T])(\d{1,2}):(\d{2})\b/.exec(body);
  if (!time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  const half = time[3]?.toLowerCase();
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  if (minute > 59) return null;
  const day = body.slice(0, time.index);
  const today = dateIn(nowMs, zone);

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (iso) {
    return wallTime(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      hour,
      minute,
      zone
    );
  }

  const monthDay = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/i.exec(day);
  const month = monthDay ? MONTHS.indexOf(monthDay[1].toLowerCase()) : -1;
  if (monthDay && month >= 0) {
    const date = Number(monthDay[2]);
    let at = wallTime(today.y, month, date, hour, minute, zone);
    // Early in January, "Dec 31" was last year's; past means next year's
    if (at <= nowMs - DAY_MS)
      at = wallTime(today.y + 1, month, date, hour, minute, zone);
    return at;
  }

  const weekday = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.exec(day);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1].toLowerCase());
    let ahead = (target - today.weekday + 7) % 7;
    let at = wallTime(today.y, today.m, today.d + ahead, hour, minute, zone);
    if (at <= nowMs) {
      ahead += 7;
      at = wallTime(today.y, today.m, today.d + ahead, hour, minute, zone);
    }
    return at;
  }

  if (/\btomorrow\b/i.test(day)) {
    return wallTime(today.y, today.m, today.d + 1, hour, minute, zone);
  }
  let at = wallTime(today.y, today.m, today.d, hour, minute, zone);
  if (at <= nowMs)
    at = wallTime(today.y, today.m, today.d + 1, hour, minute, zone);
  return at;
}

// ---- status line and usage API --------------------------------------------

/** Claude's rate_limits keys and the usage API's blocks, per kind */
const STATUS_KEYS: [string, LimitKind][] = [
  ["five_hour", "session"],
  ["seven_day", "week"],
  ["seven_day_opus", "opus"],
  ["seven_day_sonnet", "sonnet"],
];

/** Epoch seconds (or ms, if it already is) as ms */
function epochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return value < 1e12 ? value * 1000 : value;
}

/**
 * A rate limit at 100% in Claude's status line (`rate_limits.*`
 * used_percentage >= 100), with its resets_at (epoch seconds) as ms. Null
 * when none is full. With several full, the one that resets last binds
 */
export function limitFromStatus(
  rateLimits: ClaudeStatus["rate_limits"]
): DetectedLimit | null {
  if (!rateLimits) return null;
  let found: DetectedLimit | null = null;
  for (const [key, kind] of STATUS_KEYS) {
    const limit = rateLimits[key];
    if (!limit || typeof limit.used_percentage !== "number") continue;
    if (limit.used_percentage < 100) continue;
    const until = epochMs(limit.resets_at);
    if (!found || (until ?? 0) > (found.until ?? 0)) found = { kind, until };
  }
  return found;
}

function usageBlock(
  usage: UsageResponse,
  kind: LimitKind
): UsageBlock | null | undefined {
  switch (kind) {
    case "session":
      return usage.five_hour;
    case "week":
      return usage.seven_day;
    case "opus":
      return usage.seven_day_opus;
    case "sonnet":
      return usage.seven_day_sonnet;
    default:
      return null;
  }
}

/** When the usage API says `kind` resets (ms), if that is still ahead */
export function usageResetFor(
  usage: UsageResponse | null,
  kind: LimitKind,
  now: number
): number | null {
  const block = usage ? usageBlock(usage, kind) : null;
  if (!block?.resets_at) return null;
  const at = new Date(block.resets_at).getTime();
  return Number.isFinite(at) && at > now ? at : null;
}

/**
 * The usage API's full window (utilization >= 100) whose reset is still
 * ahead, the latest first: names the kind when the screen didn't
 */
export function limitFromUsage(
  usage: UsageResponse | null,
  now: number
): DetectedLimit | null {
  if (!usage) return null;
  let found: DetectedLimit | null = null;
  for (const [, kind] of STATUS_KEYS) {
    const block = usageBlock(usage, kind);
    if (!block || (block.utilization ?? 0) < 100) continue;
    const until = usageResetFor(usage, kind, now);
    if (until === null) continue;
    if (!found || until > (found.until ?? 0)) found = { kind, until };
  }
  return found;
}

/**
 * The reset to believe, in order: the status line's resets_at, the usage
 * API's resets_at for that kind, the time parsed from the screen
 */
export function resolveUntil(sources: {
  status?: number | null;
  usage?: number | null;
  screen?: number | null;
}): number | null {
  for (const at of [sources.status, sources.usage, sources.screen]) {
    if (typeof at === "number" && Number.isFinite(at) && at > 0) return at;
  }
  return null;
}
