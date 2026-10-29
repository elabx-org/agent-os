/**
 * What agents tried to do to other sessions' permissions (answer a
 * permission request, press Shift+Tab, change the mode...), allowed or
 * refused: the agent_actions table, shown on the permission card.
 */

import type Database from "better-sqlite3";
import { getDb, type AgentActionRow } from "@/lib/db";

export const AGENT_ACTOR_HEADER = "x-agentos-actor";
// AGENT_ORIGIN_HEADER in lib/agent-origin.ts, which imports this file's types
const AGENT_ORIGIN_HEADER = "x-agentos-origin";

export type AgentActionKind =
  | "prompt_answer"
  | "keys"
  | "send_keys"
  | "permission_mode"
  | "spawn"
  | "summarize";

export interface NewAgentAction {
  actorSessionId?: string | null;
  actorTmux?: string | null;
  targetSessionId: string;
  action: AgentActionKind;
  allowed: boolean;
  detail?: string | null;
  /** ms; defaults to now */
  at?: number;
}

/** GET /api/sessions/[id]/agent-actions → {actions: AgentAction[]} */
export interface AgentAction {
  /** Display name: the actor session's name, else its tmux name */
  actor: string | null;
  actorSessionId: string | null;
  action: AgentActionKind;
  allowed: boolean;
  detail: string | null;
  at: number;
}

const KEEP_MS = 30 * 86400_000;
// The user's tab retries a refused request within seconds (fetchAsUser)
const RETRY_MS = 30_000;
const LIST_LIMIT = 50;

/**
 * The tmux session the agent says it runs in (the MCP server sends its own).
 * Self-reported, so only good for display.
 */
export function agentActor(request: Request): string | null {
  const value = request.headers.get(AGENT_ACTOR_HEADER)?.trim();
  return value && /^[\w.:-]{1,128}$/.test(value) ? value : null;
}

/** The request says it's an agent's (the MCP server sends both headers) */
export function hasAgentMarkers(request: Request): boolean {
  return (
    request.headers.get(AGENT_ORIGIN_HEADER)?.toLowerCase() === "agent" ||
    request.headers.has(AGENT_ACTOR_HEADER)
  );
}

function sessionIdOfTmux(db: Database.Database, tmux: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM sessions
       WHERE tmux_name = ? OR (COALESCE(agent_type, 'claude') || '-' || id) = ?
       LIMIT 1`
    )
    .get(tmux, tmux) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Best effort: the audit never fails the request it records */
export function recordAgentAction(
  row: NewAgentAction,
  db: Database.Database = getDb()
): void {
  try {
    const at = row.at ?? Date.now();
    const actorTmux = row.actorTmux ?? null;
    const actorSessionId =
      row.actorSessionId ?? (actorTmux ? sessionIdOfTmux(db, actorTmux) : null);
    db.prepare(
      `INSERT INTO agent_actions
         (actor_session_id, actor_tmux, target_session_id, action, allowed, detail, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actorSessionId,
      actorTmux,
      row.targetSessionId,
      row.action,
      row.allowed ? 1 : 0,
      row.detail?.slice(0, 200) ?? null,
      at
    );
    db.prepare(
      `DELETE FROM agent_actions WHERE target_session_id = ? AND at < ?`
    ).run(row.targetSessionId, at - KEEP_MS);
  } catch (error) {
    console.error("[agent-actions] record failed:", error);
  }
}

/** The session the agent says it runs in, if it's one of ours */
export function agentActorSessionId(
  request: Request,
  db: Database.Database = getDb()
): string | null {
  const tmux = agentActor(request);
  return tmux ? sessionIdOfTmux(db, tmux) : null;
}

/**
 * A request refused for want of user proof. Without agent markers it can't
 * be told from an agent that left the header off, so it is recorded too;
 * if it was the user's tab with a stale cookie, its retry through the
 * proof iframe succeeds and forgetRetried takes the line back.
 */
export function recordRefusal(
  request: Request,
  row: Omit<NewAgentAction, "allowed" | "actorTmux">,
  db: Database.Database = getDb()
): void {
  recordAgentAction(
    { ...row, actorTmux: agentActor(request), allowed: false },
    db
  );
}

/** The user just did `action` with proof: drop their own refused first try */
export function forgetRetried(
  targetSessionId: string,
  action: AgentActionKind,
  db: Database.Database = getDb()
): void {
  try {
    db.prepare(
      `DELETE FROM agent_actions
       WHERE target_session_id = ? AND action = ? AND allowed = 0
         AND actor_tmux IS NULL AND at > ?`
    ).run(targetSessionId, action, Date.now() - RETRY_MS);
  } catch (error) {
    console.error("[agent-actions] forget failed:", error);
  }
}

/** Newest first, at > since (ms) */
export function listAgentActions(
  sessionId: string,
  since = 0,
  db: Database.Database = getDb()
): AgentAction[] {
  const rows = db
    .prepare(
      `SELECT a.*, s.name AS actor_name FROM agent_actions a
       LEFT JOIN sessions s ON s.id = a.actor_session_id
       WHERE a.target_session_id = ? AND a.at > ?
       ORDER BY a.at DESC, a.id DESC LIMIT ?`
    )
    .all(sessionId, since, LIST_LIMIT) as (AgentActionRow & {
    actor_name: string | null;
  })[];
  return rows.map((r) => ({
    actor: r.actor_name || r.actor_tmux,
    actorSessionId: r.actor_session_id,
    action: r.action as AgentActionKind,
    allowed: r.allowed === 1,
    detail: r.detail,
    at: r.at,
  }));
}
