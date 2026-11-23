import fs from "fs";
import { NextResponse } from "next/server";
import { readTranscript } from "@/lib/claude-transcript";
import { ownerRead } from "@/lib/backup/owner";
import { backupRow, conversationFile } from "@/lib/backup/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; session: string }> };

// GET /api/machines/[id]/backups/[session]/transcript?since=&before= - the
// copy's conversation, read only, in the same shape as a session's
// transcript. The file and Claude id come from the row alone
export async function GET(request: Request, { params }: Context) {
  const no = ownerRead(request);
  if (no) return no;
  const { id, session } = await params;
  const row = /^(m_[0-9a-f]{12}|hub)$/.test(id) ? backupRow(id, session) : null;
  if (!row) return NextResponse.json({ notFound: true });
  let file: string;
  try {
    file = conversationFile(row.machine_id, row.session_id, row.file_gen);
  } catch {
    return NextResponse.json({ notFound: true });
  }
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) {
    return NextResponse.json({
      sessionId: row.claude_session_id,
      items: [],
      offset: 0,
      start: 0,
      truncated: false,
      reset: false,
    });
  }
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const reset = !!sid && sid !== row.claude_session_id;
  const sinceParam = url.searchParams.get("since");
  const beforeParam = url.searchParams.get("before");
  const since = sinceParam !== null && !reset ? Number(sinceParam) : undefined;
  const before =
    beforeParam !== null && !reset ? Number(beforeParam) : undefined;
  try {
    const chunk = readTranscript(
      file,
      row.claude_session_id,
      "",
      since,
      before
    );
    return NextResponse.json({ ...chunk, reset });
  } catch (error) {
    console.error("[backup] reading a copy:", error);
    return NextResponse.json({ notFound: true });
  }
}
