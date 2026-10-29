/**
 * M11: what opening a search result does, as plain steps (no stores, no
 * React), so the palette and the page share it and it can be tested.
 * useOpenSearchResult runs the steps; useSearchAction and useChatJump use
 * the small rules below.
 */

import type { SearchRequest } from "@/stores/searchActions";
import type { OpenResultOptions, SearchResult } from "./types";

export type OpenStep =
  /** Open the session in the focused pane (props.onSelectSession) */
  | { kind: "select"; sessionId: string }
  /** Open it in a pane beside the focused one, in chat */
  | { kind: "beside"; sessionId: string }
  /** Show the session's chat (mobileNavActions.requestViewMode) */
  | { kind: "chat"; sessionId: string }
  /** ReplyContext's jumpTo */
  | { kind: "jump"; sessionId: string; itemId: string; switchView: boolean }
  /** props.onSelectFile, absolute path */
  | { kind: "file"; file: string; line: number }
  /** Run with the active project's runner (same project, script loaded) */
  | { kind: "runScript"; projectId: string; scriptId: string }
  /** The Scripts sheet for another project (or a script not loaded yet) */
  | { kind: "openScripts"; projectId: string }
  /** A slash command or turn action for the session's views */
  | {
      kind: "request";
      request:
        | Omit<Extract<SearchRequest, { kind: "slash" }>, "at">
        | Omit<Extract<SearchRequest, { kind: "turn" }>, "at">;
    };

export interface OpenContext {
  /** The focused session */
  currentSessionId?: string;
  /** The project whose scripts the runner holds (the focused session's) */
  runnerProjectId?: string | null;
  /** Ids of that project's loaded scripts */
  runnerScriptIds?: readonly string[];
}

/** `root` and a path relative to it, as one absolute path */
export function joinPath(root: string, rel: string): string {
  const clean = rel.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  if (!root) return rel;
  if (!clean) return root;
  return `${root.replace(/\/+$/, "")}/${clean}`;
}

/** Opens `sessionId` unless it's already the focused one */
function openSession(
  sessionId: string,
  ctx: OpenContext,
  beside: boolean | undefined
): OpenStep[] {
  if (beside) return [{ kind: "beside", sessionId }];
  if (sessionId === ctx.currentSessionId) return [];
  return [{ kind: "select", sessionId }];
}

/** The steps for one chosen result, in order */
export function openSteps(
  result: SearchResult,
  ctx: OpenContext,
  { beside }: OpenResultOptions = {}
): OpenStep[] {
  switch (result.kind) {
    case "session": {
      const id = result.hit.id;
      return beside
        ? [{ kind: "beside", sessionId: id }]
        : [{ kind: "select", sessionId: id }];
    }
    case "message": {
      const { sessionId, itemId } = result.hit;
      return [
        ...openSession(sessionId, ctx, beside),
        // Beside opens in chat already; the focused pane switches to it
        { kind: "jump", sessionId, itemId, switchView: !beside },
      ];
    }
    case "file": {
      const { root, path, line } = result.hit;
      return [{ kind: "file", file: joinPath(root, path), line: line ?? 1 }];
    }
    case "command": {
      const cmd = result.hit;
      if (cmd.kind === "script") {
        const runnable =
          !!ctx.runnerProjectId &&
          cmd.projectId === ctx.runnerProjectId &&
          !!ctx.runnerScriptIds?.includes(cmd.scriptId);
        return runnable
          ? [
              {
                kind: "runScript",
                projectId: cmd.projectId,
                scriptId: cmd.scriptId,
              },
            ]
          : [{ kind: "openScripts", projectId: cmd.projectId }];
      }
      if (cmd.kind === "slash") {
        return [
          ...openSession(cmd.sessionId, ctx, false),
          {
            kind: "request",
            request: {
              kind: "slash",
              sessionId: cmd.sessionId,
              command: cmd.command,
            },
          },
        ];
      }
      return [
        ...openSession(cmd.sessionId, ctx, false),
        { kind: "chat", sessionId: cmd.sessionId },
        {
          kind: "request",
          request: {
            kind: "turn",
            sessionId: cmd.sessionId,
            turnNo: cmd.turnNo,
            action: cmd.action,
          },
        },
      ];
    }
  }
}

/** useSearchAction's test: take it, drop it (stale), or leave it */
export function searchRequestVerdict(
  request: SearchRequest | null,
  sessionId: string,
  kind: SearchRequest["kind"],
  active: boolean,
  ttlMs: number,
  now = Date.now()
): "take" | "drop" | "wait" {
  if (!request) return "wait";
  if (now - request.at > ttlMs) return "drop";
  if (!active || !sessionId) return "wait";
  if (request.kind !== kind || request.sessionId !== sessionId) return "wait";
  return "take";
}

/**
 * A slash command at the start of the composer's text: it replaces a
 * command already there ("/rev" typed, or another one), and the rest stays
 * after it, one space apart
 */
export function prependCommand(
  text: string,
  command: string
): { text: string; caret: number } {
  const cmd = command.endsWith(" ") ? command : `${command} `;
  const rest = text.replace(/^\s*\/\S*\s*/, "").replace(/^\s+/, "");
  return { text: cmd + rest, caret: cmd.length };
}

/** Pages of earlier history a jump may load before giving up */
export const JUMP_MAX_PAGES = 10;

/**
 * useChatJump's next move: scroll to the item once it's there, load the
 * page above while it may be in older history, wait for a load in flight,
 * or drop the jump (too old, or nothing more to load)
 */
export function jumpVerdict({
  found,
  ageMs,
  ttlMs,
  canLoad,
  loading,
  pages,
}: {
  found: boolean;
  ageMs: number;
  ttlMs: number;
  /** Older history exists and a loader was given */
  canLoad: boolean;
  loading: boolean;
  /** Pages already loaded for this jump */
  pages: number;
}): "scroll" | "load" | "wait" | "drop" {
  if (ageMs > ttlMs) return "drop";
  if (found) return "scroll";
  if (loading) return "wait";
  if (canLoad && pages < JUMP_MAX_PAGES) return "load";
  // The chat may still be loading its latest page: the TTL drops it
  return "wait";
}
