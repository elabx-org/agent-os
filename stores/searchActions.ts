import { proxy } from "valtio";

/**
 * M11: what a search result asks of a session's views, consumed where the
 * state lives: a turn action by its ChatView (opens the undo sheet or the
 * turn's diff), a slash command by its composer (inserts the text). Jumps
 * to a message go through ReplyContext's jumpTo instead.
 */
export type SearchRequest =
  | {
      kind: "turn";
      sessionId: string;
      turnNo: number;
      action: "undo" | "diff";
      at: number;
    }
  | { kind: "slash"; sessionId: string; command: string; at: number };

export const searchActionStore = proxy<{ request: SearchRequest | null }>({
  request: null,
});

/** A request not taken by then (the view never showed) is dropped */
export const SEARCH_REQUEST_TTL_MS = 10_000;

type NewRequest = SearchRequest extends infer R
  ? R extends SearchRequest
    ? Omit<R, "at">
    : never
  : never;

export function requestSearchAction(request: NewRequest) {
  searchActionStore.request = { ...request, at: Date.now() } as SearchRequest;
}

export function clearSearchAction() {
  searchActionStore.request = null;
}
