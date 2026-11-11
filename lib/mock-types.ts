/*
 * What the Mocks page and the server share (lib/mocks.ts is the server's):
 * the statuses, a mock as the page gets it, and the change it sends.
 */

export const MOCK_STATUSES = [
  "ongoing",
  // The user said build it (the chat's card); completed once it's built
  "approved",
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
  /** AgentOS can show the page itself (/api/mocks/preview), not only link it */
  preview: boolean;
}

/** "AbC" from "https://claude.ai/artifact/AbC": a mock's name in a path */
export function mockId(url: string): string | null {
  return (
    url.match(
      /^https:\/\/(?:www\.)?claude\.ai\/(?:code\/)?artifacts?\/([\w-]+)/i
    )?.[1] ?? null
  );
}

/** Where AgentOS serves a mock's page, sandboxed (app/api/mocks/preview) */
export function mockPreviewSrc(url: string, version: number): string {
  return `/api/mocks/preview?url=${encodeURIComponent(url)}&v=${version}`;
}

/** What a decision on the chat's card tells the session */
export function mockDecisionText(
  decision: "approved" | "rejected",
  title: string
): string {
  return decision === "approved"
    ? `Approved the mock "${title}". Build it.`
    : `Rejected the mock "${title}". Don't build it.`;
}

/** What "Ask for changes" starts the reply with */
export function mockChangesText(title: string): string {
  return `Changes to the mock "${title}": `;
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

/**
 * The last message that links each mock, by mock id: that one shows the
 * mock's card in full, earlier ones a line pointing down to it
 */
export function lastMockMentions(
  messages: readonly { id: string; text: string }[]
): Map<string, string> {
  const last = new Map<string, string>();
  const link =
    /https:\/\/(?:www\.)?claude\.ai\/(?:code\/)?artifacts?\/([\w-]+)/gi;
  for (const message of messages) {
    for (const match of message.text.matchAll(link)) {
      last.set(match[1], message.id);
    }
  }
  return last;
}
