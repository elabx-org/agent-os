import fs from "fs";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  MOCK_PAGE_CSP,
  mockDocument,
  mockPageFile,
  type MockRow,
} from "@/lib/mocks";

export const dynamic = "force-dynamic";

// GET /api/mocks/preview?url=<artifact url> - a tracked mock's page, for the
// chat card's frame and the viewer. claude.ai can't be framed, so this is
// the page as it was published from this machine (lib/mocks.ts), served
// under a policy that keeps its scripts away from AgentOS (MOCK_PAGE_CSP)
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  const row = getDb().prepare(`SELECT * FROM mocks WHERE url = ?`).get(url) as
    | MockRow
    | undefined;
  const page = row ? mockPageFile(row) : null;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": MOCK_PAGE_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (!page) {
    return new NextResponse(
      mockDocument(
        `<p style="font:15px system-ui;padding:24px;color:#888">This mock's page isn't on this machine any more.</p>`
      ),
      { status: 404, headers }
    );
  }
  try {
    return new NextResponse(mockDocument(fs.readFileSync(page.file, "utf8")), {
      headers,
    });
  } catch {
    return new NextResponse(mockDocument(""), { status: 404, headers });
  }
}
