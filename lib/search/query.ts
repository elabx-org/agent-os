/**
 * M11: the server side of GET /api/search, one function per section.
 * Messages come from search.db (U11.1); sessions, files and commands are
 * computed per request (U11.2).
 */

import type { Session } from "../db";
import type {
  SearchCommand,
  SearchFileHit,
  SearchMessageHit,
  SearchSessionHit,
} from "./types";

/**
 * FTS5 match over indexed messages, newest first, sessions that no longer
 * exist dropped. Null when the index is off or unreadable (the response's
 * messagesEnabled false). Owned by U11.1.
 */
export function searchMessages(
  query: string,
  opts: { limit: number; sessions: Session[] }
): SearchMessageHit[] | null {
  void query;
  void opts;
  return null;
}

/** Sessions whose name, branch or project name match, best first. U11.2 */
export function searchSessions(
  query: string,
  sessions: Session[],
  projectNames: Map<string, string>,
  limit: number
): SearchSessionHit[] {
  void query;
  void sessions;
  void projectNames;
  void limit;
  return [];
}

/** Files under `root` whose path or content match (ripgrep, capped). U11.2 */
export async function searchFiles(
  query: string,
  root: string,
  limit: number
): Promise<SearchFileHit[]> {
  void query;
  void root;
  void limit;
  return [];
}

/**
 * Commands: the project's scripts, the session's turn actions (Undo turn
 * N, Open diff: This turn, when snapshots are on) and Claude slash
 * commands, matching the query. U11.2
 */
export async function searchCommands(
  query: string,
  opts: { session: Session | null; projectId: string | null; limit: number }
): Promise<SearchCommand[]> {
  void query;
  void opts;
  return [];
}
