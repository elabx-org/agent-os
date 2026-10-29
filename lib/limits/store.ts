/**
 * The sessions table's limit columns (migration 29). The detector
 * (lib/limits/watch.ts) marks and clears; the resume route and scheduler
 * (lib/limits/resume.ts) set the policy.
 */

import type Database from "better-sqlite3";
import { getDb, type Session } from "../db";
import type { LimitKind, ResumePolicy } from "./types";

export interface LimitMark {
  /** ms */
  at: number;
  /** ms, null when unknown */
  until: number | null;
  kind: LimitKind;
}

/** The limit statements on one connection (tests open their own) */
export function createLimitStore(db: Database.Database) {
  const s = {
    mark: db.prepare(
      `UPDATE sessions SET limited_at = ?, limited_until = ?, limit_kind = ?
       WHERE id = ?`
    ),
    until: db.prepare(
      `UPDATE sessions SET limited_until = ? WHERE id = ? AND limited_at IS NOT NULL`
    ),
    clear: db.prepare(
      `UPDATE sessions SET limited_at = NULL, limited_until = NULL,
         limit_kind = NULL, resume_policy = NULL, resume_text = NULL
       WHERE id = ?`
    ),
    policy: db.prepare(
      `UPDATE sessions SET resume_policy = ?, resume_text = ? WHERE id = ?`
    ),
    limited: db.prepare(
      `SELECT * FROM sessions WHERE limited_at IS NOT NULL ORDER BY limited_at`
    ),
  };
  return {
    /** Records a limit; keeps an already chosen policy */
    markLimited(sessionId: string, mark: LimitMark): void {
      s.mark.run(mark.at, mark.until, mark.kind, sessionId);
    },
    /** A later source (the usage API) told when it resets */
    setUntil(sessionId: string, until: number | null): void {
      s.until.run(until, sessionId);
    },
    /** Working again, or the user resumed: the limit and its policy go */
    clearLimited(sessionId: string): void {
      s.clear.run(sessionId);
    },
    setPolicy(
      sessionId: string,
      policy: ResumePolicy | null,
      text: string | null
    ): void {
      s.policy.run(policy, text, sessionId);
    },
    /** Every session with limited_at set, oldest limit first */
    listLimited(): Session[] {
      return s.limited.all() as Session[];
    },
  };
}

export type LimitStore = ReturnType<typeof createLimitStore>;

export function limitStore(db: Database.Database = getDb()): LimitStore {
  return createLimitStore(db);
}
