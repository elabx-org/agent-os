/**
 * M11 contract: the shape of GET /api/search, shared with the client
 * (data/search, components/Search). No server imports.
 */

/** The chips: All, Sessions, Messages, Files (commands show under All) */
export type SearchKind = "all" | "sessions" | "messages" | "files" | "commands";

export const SEARCH_KINDS: readonly SearchKind[] = [
  "all",
  "sessions",
  "messages",
  "files",
  "commands",
];

/** [start, end) character ranges of `text` to highlight */
export type HitRanges = [number, number][];

/** A session whose name, branch or project matches */
export interface SearchSessionHit {
  id: string;
  name: string;
  /** sessions.agent_type: claude, codex, gemini … */
  agentType: string;
  projectId: string | null;
  projectName: string | null;
  branch: string | null;
  /** ISO, sessions.updated_at */
  updatedAt: string;
  /** Matches in `name` */
  nameRanges: HitRanges;
}

/** One chat message (user or assistant text) from the transcript index */
export interface SearchMessageHit {
  sessionId: string;
  /** For the second line ("Claude · KeyboardBar haptics · 6m") */
  sessionName: string;
  agentType: string;
  role: "user" | "assistant";
  /** A window of the message around its first match, one line */
  snippet: string;
  /** Matches in `snippet` */
  ranges: HitRanges;
  /** ISO timestamp of the transcript entry */
  ts: string;
  /** The ChatItem id (lib/claude-transcript.ts), for jumpTo(sessionId, itemId) */
  itemId: string;
}

/** A file under the project root whose path or content matches */
export interface SearchFileHit {
  /** Relative to `root` */
  path: string;
  /** Absolute folder the path is relative to */
  root: string;
  /** Matching lines in the file (0: only the path matched) */
  hits: number;
  /** First matching line, 1-based, for opening the file there */
  line?: number;
  /** Matches in `path` */
  pathRanges: HitRanges;
}

/** A project script (.agent-os.json, M3): runs like the Scripts sheet's play */
export interface SearchScriptCommand {
  kind: "script";
  id: string;
  /** "Run script: Test" */
  label: string;
  /** The command line ("runs haptics.test.ts" in the mock: the command) */
  detail: string;
  projectId: string;
  scriptId: string;
}

/** A Claude slash command: put into the current session's composer */
export interface SearchSlashCommand {
  kind: "slash";
  id: string;
  /** "/review" */
  label: string;
  detail: string;
  /** Text to insert, "/review " */
  command: string;
  sessionId: string;
}

/** A turn action on the current session (Undo turn N, Open diff: This turn) */
export interface SearchTurnAction {
  kind: "action";
  id: string;
  label: string;
  /** "Restores 2 files, keeps chat above" */
  detail: string;
  sessionId: string;
  action: "undo" | "diff";
  turnNo: number;
  added?: number;
  removed?: number;
}

export type SearchCommand =
  | SearchScriptCommand
  | SearchSlashCommand
  | SearchTurnAction;

export interface SearchResponse {
  query: string;
  sessions: SearchSessionHit[];
  messages: SearchMessageHit[];
  files: SearchFileHit[];
  commands: SearchCommand[];
  /**
   * Flag `searchIndex` on (and the index readable): off, `messages` is
   * empty and the Messages chip and section are hidden
   */
  messagesEnabled: boolean;
  /** The session the actions are for, when one was given */
  sessionName?: string;
}

/** GET /api/search query parameters */
export interface SearchParams {
  q: string;
  kind?: SearchKind;
  /** Files are searched under this project's folder */
  projectId?: string;
  /** The current session: its actions and slash commands, and its folder
      for files when no project is given */
  sessionId?: string;
}

/** Per-section caps the route applies */
export const SEARCH_LIMITS = {
  sessions: 8,
  messages: 20,
  files: 10,
  commands: 6,
} as const;

/** Queries shorter than this return nothing (trimmed) */
export const MIN_QUERY = 2;
