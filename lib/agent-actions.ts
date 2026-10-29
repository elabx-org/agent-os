/**
 * What agents tried to do to other sessions' permissions (answer a
 * permission request, press Shift+Tab, change the mode...), allowed or
 * refused: the agent_actions table, shown on the permission card.
 */

import type Database from "better-sqlite3";
import { getDb, type AgentActionRow } from "@/lib/db";

export const AGENT_ACTOR_HEADER = "x-agentos-actor";

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
const LIST_LIMIT = 50;

/**
 * The tmux session the agent says it runs in (the MCP server sends its own).
 * Self-reported, so only good for display.
 */
export function agentActor(request: Request): string | null {
  const value = request.headers.get(AGENT_ACTOR_HEADER)?.trim();
  return value && /^[\w.:-]{1,128}$/.test(value) ? value : null;
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
