"use client";

import type {
  OpenResultOptions,
  SearchResult,
  SearchSurfaceProps,
} from "./types";

/**
 * What choosing a row does, shared by the palette and the page; closes the
 * search after. A session opens (or opens beside); a message opens its
 * session in chat and jumps to the item (ReplyContext jumpTo, loading
 * earlier history until it's there); a file opens at its line; a script
 * runs as the Scripts sheet's play; a slash command or turn action goes to
 * the session through stores/searchActions. Owned by U11.4
 */
export function useOpenSearchResult(
  props: Pick<
    SearchSurfaceProps,
    | "sessions"
    | "onOpenChange"
    | "onSelectSession"
    | "onSelectFile"
    | "currentSessionId"
  >
): (result: SearchResult, options?: OpenResultOptions) => void {
  void props;
  return () => {};
}

/** The rows in display order (sessions, messages, files, commands) */
export function flattenResults(sections: {
  sessions: SearchResult[];
  messages: SearchResult[];
  files: SearchResult[];
  commands: SearchResult[];
}): SearchResult[] {
  return [
    ...sections.sessions,
    ...sections.messages,
    ...sections.files,
    ...sections.commands,
  ];
}
