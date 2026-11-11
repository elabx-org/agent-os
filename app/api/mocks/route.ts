import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAgentOrigin } from "@/lib/agent-origin";
import {
  changeMocks,
  ingestMocks,
  mockPageFile,
  MOCK_STATUSES,
  toMock,
  type MockChange,
  type MockRow,
  type MockStatus,
} from "@/lib/mocks";

export const dynamic = "force-dynamic";

function lookups() {
  const db = getDb();
  const sessions = new Map(
    (
      db.prepare(`SELECT id, name, project_id FROM sessions`).all() as {
        id: string;
        name: string;
        project_id: string | null;
      }[]
    ).map((s) => [s.id, s])
  );
  const projects = new Map(
    (
      db.prepare(`SELECT id, name, is_uncategorized FROM projects`).all() as {
        id: string;
        name: string;
        is_uncategorized: number;
      }[]
    ).map((p) => [p.id, p])
  );
  const projectOf = (sessionId: string) => {
    const projectId = sessions.get(sessionId)?.project_id ?? null;
    return projectId && !projects.get(projectId)?.is_uncategorized
      ? projectId
      : null;
  };
  return { db, sessions, projects, projectOf };
}

// GET /api/mocks - the mocks sessions published, newest first, with their
// session, project and status (lib/mocks.ts)
export async function GET() {
  try {
    const { db, sessions, projects, projectOf } = lookups();
    ingestMocks(db, projectOf);
    const now = Date.now();
    const rows = db
      .prepare(`SELECT * FROM mocks ORDER BY updated_at DESC`)
      .all() as MockRow[];
    const mocks = rows.map((row) =>
      toMock(
        row,
        {
          session: (id) => sessions.get(id)?.name ?? null,
          project: (id) => projects.get(id)?.name ?? null,
        },
        now,
        (r) => mockPageFile(r) !== null
      )
    );
    return NextResponse.json({ mocks });
  } catch (error) {
    console.error("Error listing mocks:", error);
    return NextResponse.json({ error: "Couldn't list mocks" }, { status: 500 });
  }
}

// PATCH /api/mocks - { urls, status?, note?, pr?, archived? }: the user's
// change, or a session's through the agent-os MCP tool set_mock_status
export async function PATCH(request: Request) {
  let body: MockChange & { urls?: unknown; url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const urls = (
    Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : []
  ).filter((u): u is string => typeof u === "string" && !!u);
  if (!urls.length)
    return NextResponse.json({ error: "No mock given" }, { status: 400 });
  if (
    body.status !== undefined &&
    !MOCK_STATUSES.includes(body.status as MockStatus)
  )
    return NextResponse.json(
      { error: `Status is one of ${MOCK_STATUSES.join(", ")}` },
      { status: 400 }
    );
  const by = isAgentOrigin(request) ? "session" : "user";
  try {
    const { db, projectOf } = lookups();
    // Take in what's waiting first, so a mock just published can be marked
    ingestMocks(db, projectOf);
    const changed = changeMocks(
      db,
      urls,
      {
        status: body.status,
        note: typeof body.note === "string" ? body.note : undefined,
        pr:
          body.pr === null || typeof body.pr === "string" ? body.pr : undefined,
        archived:
          typeof body.archived === "boolean" ? body.archived : undefined,
      },
      by,
      Date.now()
    );
    if (!changed)
      return NextResponse.json(
        { error: "No such mock (only mocks published since tracking began)" },
        { status: 404 }
      );
    return NextResponse.json({ changed });
  } catch (error) {
    console.error("Error changing mocks:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't change it" },
      { status: 500 }
    );
  }
}
