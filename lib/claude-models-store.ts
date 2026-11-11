/**
 * The new-session defaults (Settings → Claude Code), saved as a preference,
 * and a session's sub-agents' model. Every function takes the connection,
 * so the tests run them on a temp DB.
 */

import type Database from "better-sqlite3";
import {
  CLAUDE_MODELS_PREFERENCE_KEY,
  NO_CLAUDE_MODELS,
  parseClaudeModels,
  type ClaudeModels,
} from "./claude-models";
import type { ClaudeModel } from "./handoff-types";

export function readClaudeModels(db: Database.Database): ClaudeModels {
  const row = db
    .prepare(`SELECT value FROM preferences WHERE key = ?`)
    .get(CLAUDE_MODELS_PREFERENCE_KEY) as { value: string } | undefined;
  if (!row) return NO_CLAUDE_MODELS;
  try {
    return parseClaudeModels(JSON.parse(row.value));
  } catch {
    return NO_CLAUDE_MODELS;
  }
}

/** Saves what's valid of it, and returns that */
export function writeClaudeModels(
  db: Database.Database,
  value: unknown
): ClaudeModels {
  const models = parseClaudeModels(value);
  db.prepare(
    `INSERT INTO preferences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(CLAUDE_MODELS_PREFERENCE_KEY, JSON.stringify(models));
  return models;
}

/** The sub-agents' model for the session's next start; null: the same */
export function setSubagentModel(
  db: Database.Database,
  sessionId: string,
  model: ClaudeModel | null
): void {
  db.prepare(
    `UPDATE sessions SET subagent_model = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(model, sessionId);
}
