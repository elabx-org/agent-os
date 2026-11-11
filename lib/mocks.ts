import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { claudeStateRoot } from "./claude-state";
import {
  effectiveStatus,
  MOCK_STATUSES,
  type Mock,
  type MockChange,
  mockId,
  type MockRow,
  type MockStatusBy,
} from "./mock-types";

export * from "./mock-types";

/*
 * Mocks: the pages sessions publish with Claude's Artifact tool, tracked
 * from the moment the hook (scripts/agentos-hook.mjs) sees them, with the
 * session and project they belong to and where each one stands.
 */

/** One line of the hook's inbox */
export interface InboxLine {
  t: number;
  session: string;
  url: string;
  version?: number;
  file?: string;
  title?: string;
  description?: string;
}

/** A name from the file when the page has no title */
function fallbackTitle(file: string | undefined, url: string): string {
  if (file) return path.basename(file).replace(/\.(html?|md)$/i, "");
  return url.split("/").pop() ?? url;
}

/**
 * Takes in what the hook saw. A new version brings a closed or archived
 * mock back as ongoing: someone is working on it again.
 */
export function applyInbox(
  db: Database.Database,
  lines: InboxLine[],
  projectOf: (sessionId: string) => string | null
): number {
  const get = db.prepare<[string], MockRow>(
    `SELECT * FROM mocks WHERE url = ?`
  );
  const insert = db.prepare(
    `INSERT INTO mocks (url, session_id, project_id, title, file, description,
       versions, created_at, updated_at, status, status_by, status_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ongoing', 'auto', ?)`
  );
  const update = db.prepare(
    `UPDATE mocks SET title = ?, file = ?, description = ?, versions = ?,
       updated_at = ?, status = ?, status_by = ?, status_note = ?,
       status_at = ?, archived_at = ?
     WHERE url = ?`
  );
  let changed = 0;
  db.transaction(() => {
    for (const line of lines) {
      if (!line?.url || typeof line.url !== "string") continue;
      const at = Number(line.t) || Date.now();
      const row = get.get(line.url);
      if (!row) {
        insert.run(
          line.url,
          line.session || null,
          line.session ? projectOf(line.session) : null,
          line.title || fallbackTitle(line.file, line.url),
          line.file ?? null,
          line.description ?? null,
          line.version ?? 1,
          at,
          at,
          at
        );
      } else {
        const reopened =
          row.status !== "ongoing" || row.archived_at !== null
            ? {
                status: "ongoing",
                by: "auto",
                note:
                  row.status !== "ongoing"
                    ? `New version after ${row.status}`
                    : "New version",
                at,
              }
            : null;
        update.run(
          line.title || row.title,
          line.file ?? row.file,
          line.description ?? row.description,
          Math.max(row.versions + (line.version ? 0 : 1), line.version ?? 0),
          Math.max(at, row.updated_at),
          reopened?.status ?? row.status,
          reopened?.by ?? row.status_by,
          reopened ? reopened.note : row.status_note,
          reopened?.at ?? row.status_at,
          null,
          line.url
        );
      }
      changed++;
    }
  })();
  return changed;
}

/** Where the hook keeps each mock's page as it was published */
function snapshotDir(): string {
  return path.join(claudeStateRoot(), "mock-snapshots");
}

/** The largest page served (the Artifact tool's own limit) */
const MAX_PAGE_BYTES = 16 * 1024 * 1024;

/**
 * The page AgentOS can show for a mock: the hook's copy from when it was
 * published, else (mocks from before there were copies) the file it was
 * published from, which may have changed since. HTML only
 */
export function mockPageFile(
  row: Pick<MockRow, "url" | "file">
): { file: string; snapshot: boolean } | null {
  const id = mockId(row.url);
  const usable = (file: string) => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() && stat.size > 0 && stat.size <= MAX_PAGE_BYTES;
    } catch {
      return false;
    }
  };
  if (id) {
    const copy = path.join(snapshotDir(), `${id}.html`);
    if (usable(copy)) return { file: copy, snapshot: true };
  }
  if (row.file && /\.html?$/i.test(row.file) && usable(row.file))
    return { file: row.file, snapshot: false };
  return null;
}

/**
 * The page as a whole document. The Artifact tool publishes a fragment and
 * wraps it; this is that wrapper (charset, viewport, its small reset). A
 * file that is a document already goes as it is
 */
export function mockDocument(page: string): string {
  if (/^\s*(?:<!doctype|<html[\s>])/i.test(page)) return page;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
}

/**
 * The policy a mock's page is served under. `sandbox` without
 * allow-same-origin gives it an origin of its own, so its scripts can't
 * read AgentOS's cookies or storage, and nothing but what a published
 * Artifact may load (its CDNs, Google Fonts, inline and data:) is fetched:
 * no requests to AgentOS or anywhere else
 */
export const MOCK_PAGE_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "frame-ancestors 'self'",
].join("; ");

function inboxFile(): string {
  return path.join(claudeStateRoot(), "mocks.jsonl");
}

/**
 * Moves the hook's inbox aside and takes it in: a hook appending meanwhile
 * starts a new file, so nothing is read twice or lost
 */
export function ingestMocks(
  db: Database.Database,
  projectOf: (sessionId: string) => string | null
): number {
  const file = inboxFile();
  const taking = `${file}.${process.pid}.${Date.now()}.taking`;
  try {
    fs.renameSync(file, taking);
  } catch {
    return 0;
  }
  try {
    const lines: InboxLine[] = [];
    for (const text of fs.readFileSync(taking, "utf8").split("\n")) {
      if (!text.trim()) continue;
      try {
        lines.push(JSON.parse(text));
      } catch {
        // A torn line: skip it
      }
    }
    return applyInbox(db, lines, projectOf);
  } finally {
    fs.rmSync(taking, { force: true });
  }
}

export function toMock(
  row: MockRow,
  names: {
    session: (id: string) => string | null;
    project: (id: string) => string | null;
  },
  now: number,
  /** Whether its page can be shown here (mockPageFile); left out: no */
  hasPreview: (row: MockRow) => boolean = () => false
): Mock {
  const { status, auto } = effectiveStatus(row, now);
  return {
    url: row.url,
    title: row.title || fallbackTitle(row.file ?? undefined, row.url),
    description: row.description,
    sessionId: row.session_id,
    sessionName: row.session_id ? names.session(row.session_id) : null,
    projectId: row.project_id,
    projectName: row.project_id ? names.project(row.project_id) : null,
    versions: row.versions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status,
    statusBy: auto && status !== row.status ? "auto" : row.status_by,
    statusNote:
      auto && status === "abandoned" && row.status === "ongoing"
        ? "No new version for 7 days"
        : row.status_note,
    pr: row.pr,
    archived: row.archived_at !== null,
    preview: hasPreview(row),
  };
}

/** A status, a PR or archiving, from the user or a session */
export function changeMocks(
  db: Database.Database,
  urls: string[],
  change: MockChange,
  by: Exclude<MockStatusBy, "auto">,
  now: number
): number {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (change.status) {
    if (!MOCK_STATUSES.includes(change.status))
      throw new Error(`Unknown status ${change.status}`);
    sets.push(
      "status = ?",
      "status_by = ?",
      "status_at = ?",
      "status_note = ?"
    );
    args.push(change.status, by, now, change.note ?? null);
  } else if (change.note !== undefined) {
    sets.push("status_note = ?");
    args.push(change.note);
  }
  if (change.pr !== undefined) {
    sets.push("pr = ?");
    args.push(change.pr ? String(change.pr).trim() || null : null);
  }
  if (change.archived !== undefined) {
    sets.push("archived_at = ?");
    args.push(change.archived ? now : null);
  }
  if (!sets.length || !urls.length) return 0;
  const stmt = db.prepare(`UPDATE mocks SET ${sets.join(", ")} WHERE url = ?`);
  let n = 0;
  db.transaction(() => {
    for (const url of urls) n += stmt.run(...args, url).changes;
  })();
  return n;
}
