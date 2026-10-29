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

// Sessions, files and commands are computed per request (U11.2)
export { searchCommands, searchFiles, searchSessions } from "./sections";
