/**
 * sessions.started_by: a session that a session on another machine
 * started (POST /api/sessions with x-agentos-chain), and how many times in
 * a row sessions have started each other across machines. AgentOS carries
 * the count itself on both sides (the machine's /api/hub route and the
 * hub's link), so a tool can't reset it. Client-safe apart from ownDepth,
 * which is handed the database.
 */

import type Database from "better-sqlite3";

export interface StartedBy {
  /** "hub" or the machine's id, as the server that started it names it */
  machineId: string;
  /** That machine's name when it started it */
  machine: string;
  /** 1 for a session a person's session started; each hop adds one */
  depth: number;
  at: number;
}

/** Starts across machines in a row; the next one is the user's to make */
export const MAX_CHAIN = 3;

export function parseStartedBy(
  raw: string | null | undefined
): StartedBy | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StartedBy;
    return typeof value?.machineId === "string" &&
      typeof value.machine === "string" &&
      Number.isInteger(value.depth)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function startedByLine(s: StartedBy): string {
  return `Started by a session on ${s.machine}`;
}

/** The chain header as a number; null when absent or not a single digit */
export function chainOf(request: Request): number | null {
  const value = request.headers.get("x-agentos-chain");
  return value && /^[0-9]$/.test(value) ? Number(value) : null;
}

/**
 * How far along the chain the asking session is: the started_by depth of
 * the session here that x-agentos-actor names (its tmux), else 0
 */
export function ownDepth(request: Request, db: Database.Database): number {
  return depthOfActor(request.headers.get("x-agentos-actor"), db);
}

export function depthOfActor(
  actor: string | null | undefined,
  db: Database.Database
): number {
  const tmux = actor?.trim();
  // A session on a linked machine (link:<id>) is never one of ours
  if (!tmux || !/^[\w.:-]{1,128}$/.test(tmux) || tmux.startsWith("link:")) {
    return 0;
  }
  try {
    const row = db
      .prepare(
        `SELECT started_by FROM sessions
         WHERE tmux_name = ? OR (COALESCE(agent_type, 'claude') || '-' || id) = ?
         LIMIT 1`
      )
      .get(tmux, tmux) as { started_by: string | null } | undefined;
    return Math.min(
      9,
      Math.max(0, parseStartedBy(row?.started_by)?.depth ?? 0)
    );
  } catch {
    return 0;
  }
}
