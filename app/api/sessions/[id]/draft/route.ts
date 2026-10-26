import { NextRequest, NextResponse } from "next/server";
import { queries, getDb } from "@/lib/db";

const MAX_LENGTH = 100_000;

interface DraftRow {
  text: string;
  updated_at: number;
}

// GET /api/sessions/[id]/draft - the unsent message, and when it last changed
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = queries.getDraft(getDb()).get(id) as DraftRow | undefined;
  return NextResponse.json({
    text: row?.text ?? "",
    updatedAt: row?.updated_at ?? 0,
  });
}

// PUT /api/sessions/[id]/draft - save it. An empty draft is kept as a row,
// so other devices see that it was cleared (sent, or deleted by hand)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  if (!queries.getSession(db).get(id)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const text = body?.text;
  if (typeof text !== "string" || text.length > MAX_LENGTH) {
    return NextResponse.json({ error: "Invalid draft" }, { status: 400 });
  }
  const updatedAt = Date.now();
  queries.upsertDraft(db).run(id, text, updatedAt);
  return NextResponse.json({ updatedAt });
}
