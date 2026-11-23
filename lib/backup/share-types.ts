/**
 * Sharing a server's sessions with a linked machine, and how each copy
 * stands, as the pages show them. No server imports.
 */

export const SHARE_LEVELS = ["none", "some", "all"] as const;

export interface MachineShare {
  /** none: nothing; some: the projects listed; all: every project */
  level: (typeof SHARE_LEVELS)[number];
  projects: string[];
}

export type SyncState = "synced" | "waiting" | "failed" | "elsewhere";

/** One session's copy on the other side */
export interface SyncRow {
  sessionId: string;
  name: string;
  projectName: string | null;
  /** to: lives on this server, copied to the machine; from: the reverse */
  direction: "to" | "from";
  state: SyncState;
  /** When both sides were last known to be the same */
  syncedAt: number | null;
  /** The code's commit in the copy */
  head: string | null;
  unsaved: number | null;
  /** Lines of conversation in the copy */
  entries: number | null;
  /** Why the last try failed, in the user's words */
  error?: string;
}

/** GET /api/machines/[id]/sync */
export interface SyncView {
  machineName: string;
  hubName: string;
  online: boolean;
  /** The machine's AgentOS can take copies of this server's sessions */
  supported: boolean;
  share: MachineShare;
  /** Its sessions are copied to this server (the older switch) */
  backup: boolean;
  projects: { id: string; name: string; sessions: number }[];
  rows: SyncRow[];
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  working: boolean;
}

/** "3f9c2ab + 2 unsaved files": the code a copy holds */
export function codeText(row: Pick<SyncRow, "head" | "unsaved">): string {
  if (!row.head) return "no code";
  const unsaved = row.unsaved
    ? ` + ${row.unsaved} unsaved ${row.unsaved === 1 ? "file" : "files"}`
    : "";
  return `code at ${row.head.slice(0, 7)}${unsaved}`;
}

/** "214 entries, code at 3f9c2ab": a copy's revision */
export function revisionText(row: SyncRow): string {
  const talk =
    row.entries == null
      ? null
      : `${row.entries} ${row.entries === 1 ? "entry" : "entries"}`;
  return [talk, codeText(row)].filter(Boolean).join(", ");
}

/** One line for the whole link */
export function syncSummary(view: Pick<SyncView, "rows" | "online">): string {
  const failed = view.rows.filter((r) => r.state === "failed").length;
  const waiting = view.rows.filter((r) => r.state === "waiting").length;
  if (view.rows.length === 0) return "Nothing is shared yet";
  if (failed) {
    return failed === 1
      ? "1 session couldn't be copied"
      : `${failed} sessions couldn't be copied`;
  }
  if (waiting) {
    return view.online
      ? waiting === 1
        ? "1 session is being copied"
        : `${waiting} sessions are being copied`
      : "Waiting for it to come online";
  }
  return "Everything is in sync";
}
