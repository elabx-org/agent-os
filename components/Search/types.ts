import type { Session } from "@/lib/db";
import type {
  SearchCommand,
  SearchFileHit,
  SearchMessageHit,
  SearchSessionHit,
} from "@/lib/search/types";

/**
 * What the views give the search (replaces QuickSwitcher's props). The
 * palette (desktop, D-Search) and the page (phone and Duo, N-Search) take
 * the same props; SearchHost picks one by layout mode.
 */
export interface SearchSurfaceProps {
  sessions: Session[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the session in the focused pane */
  onSelectSession: (sessionId: string) => void;
  /** Opens a file (absolute path) at a line */
  onSelectFile?: (file: string, line: number) => void;
  /** The focused session: actions, slash commands, the files' folder */
  currentSessionId?: string;
  activeSessionWorkingDir?: string;
}

/** One selectable row, in display order, for the keyboard and for opening */
export type SearchResult =
  | { kind: "session"; hit: SearchSessionHit }
  | { kind: "message"; hit: SearchMessageHit }
  | { kind: "file"; hit: SearchFileHit }
  | { kind: "command"; hit: SearchCommand };

export interface OpenResultOptions {
  /** ⌘↵: a session (or a message's session) opens beside the focused one */
  beside?: boolean;
  /**
   * Chosen with Enter, not a click: a script opens the Scripts sheet
   * instead of running, so a keystroke never starts one by itself
   */
  fromKeyboard?: boolean;
}
