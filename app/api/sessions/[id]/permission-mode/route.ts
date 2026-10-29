import { NextRequest, NextResponse } from "next/server";

// GET /api/sessions/[id]/permission-mode - PermissionModeState
export async function GET(
  _request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

// POST /api/sessions/[id]/permission-mode {mode, allowPending?} -
// SetPermissionModeResult; full access and allowPending are user only
export async function POST(
  _request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
