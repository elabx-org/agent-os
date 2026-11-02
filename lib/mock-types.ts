/*
 * What the Mocks page and the server share (lib/mocks.ts is the server's):
 * the statuses, a mock as the page gets it, and the change it sends.
 */

export const MOCK_STATUSES = [
  "ongoing",
  "completed",
  "rejected",
  "abandoned",
] as const;
export type MockStatus = (typeof MOCK_STATUSES)[number];
/** Who set the status: the hook, the user, or a session's tool */
export type MockStatusBy = "auto" | "user" | "session";

/** An ongoing mock with no new version for this long reads as abandoned */
export const ABANDON_MS = 7 * 24 * 60 * 60 * 1000;

export interface MockRow {
  url: string;
  session_id: string | null;
  project_id: string | null;
  title: string | null;
  file: string | null;
  description: string | null;
  versions: number;
  created_at: number;
  updated_at: number;
  status: MockStatus;
  status_by: MockStatusBy;
  status_note: string | null;
  status_at: number | null;
  pr: string | null;
  archived_at: number | null;
}

export interface Mock {
  url: string;
  title: string;
  description: string | null;
  sessionId: string | null;
  sessionName: string | null;
  projectId: string | null;
  projectName: string | null;
  versions: number;
  createdAt: number;
  updatedAt: number;
  status: MockStatus;
  statusBy: MockStatusBy;
  /** Why it stands where it does, in a few words */
  statusNote: string | null;
  pr: string | null;
  archived: boolean;
}

/** What it shows as: a quiet ongoing mock the hook set turns abandoned */
export function effectiveStatus(
  row: Pick<MockRow, "status" | "status_by" | "updated_at">,
  now: number
): { status: MockStatus; auto: boolean } {
  if (
    row.status === "ongoing" &&
    row.status_by === "auto" &&
    now - row.updated_at >= ABANDON_MS
  ) {
    return { status: "abandoned", auto: true };
  }
  return { status: row.status, auto: row.status_by === "auto" };
}

export interface MockChange {
  status?: MockStatus;
  note?: string | null;
  pr?: string | null;
  archived?: boolean;
}
